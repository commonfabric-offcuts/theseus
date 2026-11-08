from __future__ import annotations

"""An outcome's pipeline state, derived from its facts alone (docs/pipeline.md, "The derived state").

The facts are what people, agents and deploys did, in the order they did it: each outcome's log of starts, combines,
drops, finishes, release records and turning releases on or off (`pipeline_facts`, append-only), its pieces (their kind
and topic), the items each release record names, and whether each piece's topic is the outcome's conversation. derive()
reads nothing else: not the member rows, the ends written on stage entries, or the topics' states, which are what it
computes. Every pipeline write appends its fact and then writes the differences between derive() and what is stored
(Pipeline._settle), so what is stored is always derive() of the facts so far, and an end never depends on which command
ran last.

The log carries the order that is really there: a drop then a put back then a new piece is new work, and a combine
before or after a release record decides which release that record is. What a record names it ships as if it had
come before the acts it makes impossible: a drop of the item with no piece taking it since (which also undoes the
combine that drop kept it out of) and, for the release the record ships, a return to building. derive() plays the log
in order and applies those rules when it reaches the record, so the same facts give the same state in any order that
the commands accept.
"""

import json
from collections import namedtuple

# One piece: its id, 'piece' or 'release', its topic, and whether that topic is an ordinary one (not the outcome's
# conversation, which never ends).
Piece = namedtuple("Piece", "id kind topic_id ordinary_topic")
# One fact: (seq, kind, ms, by, payload) with kind ships, start, combine, drop, finish or record.
Fact = namedtuple("Fact", "seq kind ms by payload")
Facts = namedtuple("Facts", "pieces log records")
# The derived state.
# - members: (piece_id, number, left_ms, left_reason) for every piece an item is or was in, in the order they took it;
#   left_ms and left_reason are None while the piece holds it.
# - ends: {piece_id: None while open, or (outcome, note, ended_ms, ended_by)} for each piece no act closed (a combine
#   closes a piece `combined`, a finish `done`).
# - done_topics: {topic_id: N}: the topics all of whose pipeline work has shipped or left them, N the newest release
#   that shipped some of it.
# - shipped_in: {number: N}: what the records the outcome has taken as its own ship.
State = namedtuple("State", "members ends done_topics shipped_in")


def read_facts(db, workspace_id):
    """The facts derive() reads for one outcome, from its records."""
    pieces = [Piece(row[0], row[1], row[2], row[3] == "topic") for row in db.execute(
        "SELECT p.id,p.kind,p.topic_id,t.kind FROM pipeline_pieces p JOIN topics t ON t.id=p.topic_id WHERE p.workspace_id=? ORDER BY p.rowid",
        (workspace_id,))]
    log = [Fact(row[0], row[1], row[2], row[3], json.loads(row[4])) for row in db.execute(
        "SELECT seq,kind,ms,by,payload FROM pipeline_facts WHERE workspace_id=? ORDER BY seq", (workspace_id,))]
    records = {row[0]: tuple(json.loads(row[1])) for row in db.execute("SELECT number,items FROM releases")}
    return Facts(pieces, log, records)


def derive(facts):
    """THE DERIVED STATE: the complete pipeline state of one outcome from its facts (module docstring)."""
    return _Play(facts).run()


class Inconsistent(Exception):
    """The facts contradict themselves (an item taken while another piece holds it): never written, always loud."""


class _Row(object):
    __slots__ = ("piece", "number", "held", "reason", "left_ms", "came_from")

    def __init__(self, piece, number, came_from):
        self.piece, self.number, self.came_from = piece, number, came_from
        self.held, self.reason, self.left_ms = False, None, None


class _Play(object):
    """The log played in order. State while playing:
    - rows {(piece, number): _Row} and their order; holder {number: piece};
    - line {number: [row keys]}: the item's current line of work, each row whose part in it is not decided yet. An
      item's rows in the order pieces took it are one line (combined into a release, gone back to building) until it is
      dropped or shipped;
    - tentative {number: drop}: the drop that decided its last line, until a piece takes the item again (the drop then
      stands) or a record names it (the drop counts for nothing);
    - parts {row key: ('dropped',) or ('shipped', N)}: how a piece's part in an item was decided."""

    def __init__(self, facts):
        self.facts = facts
        self.pieces = {piece.id: piece for piece in facts.pieces}
        self.order = [piece.id for piece in facts.pieces]
        self.rows, self.row_order, self.holder, self.line, self.tentative, self.parts = {}, [], {}, {}, {}, {}
        # Each piece's rows in the order it took them, and how many it holds; the pieces a fact touched.
        self.rows_of, self.holding, self.touched = {piece: [] for piece in self.order}, {piece: 0 for piece in self.order}, set()
        self.act_end, self.combined_into, self.combine_ms = {}, {}, {}
        self.ended, self.shipped_by, self.emptied_next, self.shipped_in = {}, {}, {}, {}
        self.ships = False
        # The releases whose combine has been played: a release that a later fact combines is not there yet.
        self.begun = set()
        # Records the log does not mention were written before the outcome had a pipeline: the first turn on takes them.
        logged = {fact.payload["release"] for fact in facts.log if fact.kind == "record"}
        self.written = sorted(number for number in facts.records if number not in logged)

    # ---- playing --------------------------------------------------------------------------------------------------

    def run(self):
        for fact in self.facts.log:
            self.touched = set()
            getattr(self, "_" + fact.kind)(fact)
            self._close_emptied(fact)
        return self._state()

    def _ships(self, fact):
        # Turning releases on makes every record written so far the outcome's: each ships what it names wherever it is
        # still being built (no release: only the record written as the next one ships a release).
        if fact.payload["on"] and not self.ships:
            self.ships = True
            for number in list(self.written):
                self._apply(number, fact, None)
        self.ships = bool(fact.payload["on"])

    def _record(self, fact):
        number = fact.payload["release"]
        next_number = max(self.written, default=0) + 1
        self.written.append(number)
        if self.ships:
            self._apply(number, fact, self._shipping(number, next_number))

    def _start(self, fact):
        piece, release = fact.payload["piece"], fact.payload.get("from_release")
        self._known(piece, "piece")
        for number in fact.payload["numbers"]:
            if release is not None:
                # D35: back to building from a held release.
                if self.holder.get(number) != release:
                    raise Inconsistent("Item %d is not in release piece %s" % (number, release))
                self._leave(self.rows[(release, number)], "returned", fact.ms)
            elif number in self.holder:
                raise Inconsistent("Item %d is already in piece %s" % (number, self.holder[number]))
            # Taken again after a drop, the drop stands (it ended the line it was in), and this is new work.
            self.tentative.pop(number, None)
            self._take(piece, number, release)

    def _combine(self, fact):
        release = fact.payload["release"]
        self._known(release, "release")
        self.begun.add(release)
        for piece in fact.payload["pieces"]:
            self.act_end[piece], self.combined_into[piece], self.combine_ms[piece] = "combined", release, fact.ms
            for row in self._held(piece):
                self._leave(row, "combined", fact.ms)
                self._take(release, row.number, piece)

    def _drop(self, fact):
        number = fact.payload["number"]
        piece = self.holder.get(number)
        if piece is not None:
            if piece in self.ended or piece in self.act_end:
                return  # a finished piece, or the release it shipped in, keeps it
            row = self.rows[(piece, number)]
            self._leave(row, "dropped", fact.ms)
            self.tentative[number] = {"row": row, "held": True, "rows": self.line.pop(number, [])}
        elif self.line.get(number):
            # Dropped where no piece holds it (it went back to building when its release shipped without it): the drop
            # ends the line it was in, and leaves its mark on the row it last left.
            rows = self.line.pop(number)
            self.tentative[number] = {"row": rows[-1], "held": False, "rows": rows, "was": rows[-1].reason}
            rows[-1].reason = "dropped"
        else:
            return
        for row in self.tentative[number]["rows"]:
            self.parts[(row.piece, number)] = ("dropped",)

    def _finish(self, fact):
        self.act_end[fact.payload["piece"]] = "done"

    # ---- a release record -----------------------------------------------------------------------------------------

    def _shipping(self, number, next_number):
        """The release piece a record ships: only the record of the next number does, and it ships the release open (one
        at a time), or with none open the first release emptied while it was the next one (number) that would hold an
        item the record names had the acts the record makes impossible not happened. A release combined after the record
        was not open when it was written, so the record never ships it."""
        if number != next_number:
            return None
        for piece in self.order:
            if self.pieces[piece].kind == "release" and piece in self.begun and piece not in self.ended:
                return piece
        items = self.facts.records[number]
        for piece in self.order:
            if (self.pieces[piece].kind == "release" and piece not in self.shipped_by and self.emptied_next.get(piece) == number
                    and any(self._where(item, piece) == piece for item in items)):
                return piece
        return None

    def _where(self, number, shipping):
        """Where the item would be, had the acts the record makes impossible not happened: a drop no piece took it after
        (it stays in the piece it was dropped from, or goes on with that piece into the release it was combined into
        after the drop), and a return to building from the release this record ships. A finished piece keeps it."""
        piece = self.holder.get(number)
        if piece is not None and self.act_end.get(piece) == "done":
            return piece
        drop = self.tentative.get(number)
        if drop is not None:
            piece = drop["row"].piece if drop["held"] else None
            piece = self.combined_into.get(piece, piece)
        if shipping is not None and piece is not None and piece != shipping:
            row = self.rows.get((piece, number))
            if row is not None and row.came_from == shipping:
                piece = shipping
        return piece

    def _apply(self, number, fact, shipping):
        """A record of release number, taken as the outcome's: each item it names has shipped in it (_ship), and the
        release it ships (if any) holds those of its items and sends the rest back to building."""
        items = self.facts.records[number]
        for item in items:
            self._ship(item, number, fact.ms, shipping)
        if shipping is not None:
            for row in self._held(shipping):
                if row.number not in items:
                    self._leave(row, "returned", fact.ms)
            self.shipped_by[shipping] = number
            self.ended.setdefault(shipping, (fact.ms, None))

    def _ship(self, number, release, ms, shipping):
        where = self._where(number, shipping)
        drop = self.tentative.pop(number, None)
        line = self.line.pop(number, [])
        if drop is not None:
            # The drop counts for nothing.
            line = drop["rows"]
            row = drop["row"]
            if not drop["held"]:
                row.reason = drop["was"]
            elif row.piece in self.combined_into:
                # ... nor does the combine it kept the item out of: the item went on into that release.
                row.reason, row.left_ms = "combined", self.combine_ms[row.piece]
                into = self.combined_into[row.piece]
                line = line + [self.rows.get((into, number)) or self._take(into, number, row.piece, held=False, ms=ms)]
        holder = self.holder.get(number)
        if shipping is not None and where == shipping:
            # The release this record ships holds it; whatever was building it again has shipped it there.
            if holder is not None and holder != shipping:
                self._leave(self.rows[(holder, number)], "returned", ms)
            row = self.rows.get((shipping, number)) or self._take(shipping, number, None, held=False, ms=ms)
            self._hold(row)
            if row not in line:
                line.append(row)
        elif where is not None and (self.act_end.get(where) == "done" or where in self.shipped_by):
            pass  # a finished piece, or a release that already shipped, keeps it
        else:
            if holder is not None and holder not in self.ended and holder not in self.act_end:
                self._leave(self.rows[(holder, number)], "returned", ms)
            if where is not None and (where, number) in self.rows:
                row = self.rows[(where, number)]
                if not row.held and row.reason in ("dropped", None):
                    row.reason = "returned"
                    row.left_ms = row.left_ms if row.left_ms is not None else ms
        for row in line:
            self.parts[(row.piece, number)] = ("shipped", release)
        self.shipped_in[number] = release

    # ---- helpers --------------------------------------------------------------------------------------------------

    def _known(self, piece, kind):
        if piece not in self.pieces or self.pieces[piece].kind != kind:
            raise Inconsistent("No %s %s" % (kind, piece))

    def _take(self, piece, number, came_from, held=True, ms=None):
        row = _Row(piece, number, came_from)
        self.rows[(piece, number)] = row
        self.row_order.append(row)
        self.rows_of[piece].append(row)
        self.touched.add(piece)
        if held:
            self._hold(row)
            self.line.setdefault(number, []).append(row)
        else:
            row.held, row.reason, row.left_ms = False, "returned", ms
        return row

    def _hold(self, row):
        if row.held:
            return
        if row.number in self.holder:
            raise Inconsistent("Item %d is already in piece %s" % (row.number, self.holder[row.number]))
        row.held, row.reason, row.left_ms = True, None, None
        self.holder[row.number] = row.piece
        self.holding[row.piece] += 1
        self.touched.add(row.piece)

    def _leave(self, row, reason, ms):
        if row.held:
            self.holding[row.piece] -= 1
            self.touched.add(row.piece)
        row.held, row.reason, row.left_ms = False, reason, ms
        if self.holder.get(row.number) == row.piece:
            del self.holder[row.number]

    def _held(self, piece):
        return [row for row in self.rows_of[piece] if row.held]

    def _close_emptied(self, fact):
        """A piece under way that holds nothing has ended, at this fact, by whoever's act it was: nobody's when a record
        emptied it, whether written now or taken when releases were turned on; a release remembers the number it would
        have shipped as."""
        by = None if fact.kind in ("record", "ships") else fact.by
        for piece in sorted(self.touched, key=self.order.index):
            if self.holding[piece] or piece in self.ended or piece in self.act_end:
                continue
            self.ended[piece] = (fact.ms, by)
            if self.pieces[piece].kind == "release":
                self.emptied_next[piece] = max(self.written, default=0) + 1

    # ---- the state ------------------------------------------------------------------------------------------------

    def _part(self, row):
        part = self.parts.get((row.piece, row.number))
        if part is not None:
            return part
        return ("done",) if self.act_end.get(self.holder.get(row.number)) == "done" else ("left",)

    def _state(self):
        members = [(row.piece, row.number, row.left_ms, row.reason) for row in self.row_order]
        held = {piece for piece, count in self.holding.items() if count}
        ends = {}
        for piece in self.order:
            if piece in self.act_end:
                continue
            if self.pieces[piece].kind == "release":
                if piece in self.shipped_by:
                    end = ("shipped", "Shipped in release %d" % self.shipped_by[piece])
                else:
                    end = None if piece in held or piece not in self.ended else self._emptied(piece)
            elif piece in held or piece not in self.ended:
                end = None
            else:
                shipped = [part[1] for part in (self._part(row) for row in self.rows_of[piece]) if part[0] == "shipped"]
                end = ("shipped", "Shipped in release %d" % max(shipped)) if shipped else ("dropped", "")
            ends[piece] = None if end is None else end + self.ended[piece]
        done = {}
        by_topic = {}
        for piece in self.order:
            by_topic.setdefault(self.pieces[piece].topic_id, []).append(piece)
        for topic_id, pieces in by_topic.items():
            if not self.pieces[pieces[0]].ordinary_topic:
                continue
            left, newest = False, 0
            for piece in pieces:
                if self.pieces[piece].kind == "release":
                    # A release keeps its topic open while it is being put together; what it shipped is its own number.
                    left = left or (piece not in self.ended and piece not in self.act_end)
                    newest = max(newest, self.shipped_by.get(piece, 0))
                    continue
                for row in self.rows_of[piece]:
                    part = self._part(row)
                    left = left or part[0] == "left"
                    newest = max(newest, part[1] if part[0] == "shipped" else 0)
            if not left and newest:
                done[topic_id] = newest
        return State(members, ends, done, dict(self.shipped_in))

    def _emptied(self, piece):
        """How a release with no item left ended, when no record of its own release shipped it: dropped when every item
        was dropped, else held, saying what took its items."""
        went_back = shipped = dropped = None
        for row in self.rows_of[piece]:
            if row.reason == "dropped":
                dropped = True
            elif row.number in self.shipped_in:
                shipped = max(shipped or 0, self.shipped_in[row.number])
            else:
                went_back = True
        if not (went_back or shipped):
            return ("dropped", "")
        if not dropped and not shipped:
            return ("held", "Every item went back to building")
        if not dropped and not went_back:
            return ("held", "Its last items shipped in release %d" % shipped)
        took = [words for words, said in (("went back to building", went_back), ("shipped in release %d" % (shipped or 0), shipped),
                                          ("were dropped", dropped)) if said]
        return ("held", "Its items " + ", ".join(took[:-1]) + " or " + took[-1])
