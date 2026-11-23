from __future__ import annotations

"""Explicit outcome Links editing through the existing Core service (1102)."""

from urllib.parse import urlsplit

from .contract import LIMITS
from .workspace_links import canonical_url


def register(verb):
    for name in ('link-add', 'link-rename', 'link-remove'):
        parser = verb(name)
        parser.add_argument('outcome')
        parser.add_argument('url')
        if name == 'link-add':
            parser.add_argument('--title')
        elif name == 'link-rename':
            parser.add_argument('title')


class LinkVerbs:
    def _link_row(self, url, recorded=False):
        args = {'workspace_id': self.options.outcome, 'limit': LIMITS['page_max']}
        while True:
            if recorded:
                page = self.read_back('workspace_links', args, {
                    'what': 'the Link change in %s was recorded' % self.options.outcome,
                    'kind': 'workspace.link_set', 'it': 'the Link change'},
                    'read workspace_links for %s; retry the saved operation only to recover its receipt' % self.options.outcome)
            else:
                page = self.view('workspace_links', args)
            found = next((row for row in page['items'] if row['url'] == url), None)
            if found is not None or page.get('next_cursor') is None:
                return found
            args['cursor'] = page['next_cursor']

    def _set_link(self, action):
        url = canonical_url(self.options.url)
        row = self._link_row(url)
        if action != 'add' and (row is None or action == 'rename' and row['removed']):
            self.refuse('LINK_NOT_FOUND', 'No kept Link at that address; use link-add to keep it first')
        if action == 'remove':
            title = row['title']
        else:
            title = self.options.title
            if title is None:
                host = urlsplit(url).hostname
                title = '[' + host + ']' if ':' in host else host
        self.command('workspace.link_set', {'workspace_id': self.options.outcome},
                     {'url': url, 'title': title, 'removed': action == 'remove'},
                     {'link_revision': row['revision'] if row else 0})
        current = self._link_row(url, recorded=True)
        if current is None:
            # Rows are retained on removal. Absence is an unconfirmed read,
            # never a reason to submit a second write with a new operation.
            from .cli import Failed, _diagnostic
            _diagnostic(self.out.stderr, 'READ_BACK_UNCONFIRMED: workspace.link_set was recorded '
                        '(operation %s), but workspace_links did not return the Link; do not send '
                        'the Link change again; recover its saved receipt with retry %s.' %
                        (self.operation, self.operation))
            raise Failed(1, recorded=True)
        self.out.plain('%s Link in %s: %s  %s (revision %d; operation %s recorded; read back)' % (
            'Removed' if current['removed'] else 'Kept', self.options.outcome,
            current['title'], current['url'], current['revision'], self.operation))

    def do_link_add(self):
        self._set_link('add')

    def do_link_rename(self):
        self._set_link('rename')

    def do_link_remove(self):
        self._set_link('remove')
