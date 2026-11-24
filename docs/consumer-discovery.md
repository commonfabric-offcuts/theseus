# Consumer discovery

Fast lane row 8 uses one read-only command:

    /usr/bin/python3 -I tools/consumers.py --base BASE

It lists test files that import changed files, through local modules/helpers,
or read them as source text. It compares BASE with the working tree, including
untracked source. Use --head COMMIT for two committed trees, or give explicit
repository-relative paths after the options. --explain shows one dependency
chain per test with dependency kind and source version; --json retains the
inputs, chains, removed tests and unresolved expressions for another command.
The detailed output labels Python units, Node units and browser consumers.

The graph includes both sides of the change: removing an import must not hide
its former consumers. Imports are parsed without importing repository code.
Source reads conservatively include repository-path literals in a module that
reads files, including paths split into literal components and basename lists.
That can overselect. Recognized opaque reads/imports and parse failures stay
visible as unresolved. Other dynamic loading, served-product reads and native
selectors need the builder's behavior-based selection; an empty result never
proves that no consumer exists.

The command never executes tests, decides readiness, grants permission, or
changes the shipping path. It returns success for a readable analysis, including
one with unresolved expressions. An unreadable Git revision or source is an
error, not an empty selection. Lanes run selected files unfiltered under the
current execution rule. Browser files in the output remain browser consumers,
not an instruction to start a browser.

The source-text regressions from 1169 (an evaluated author line), 1174 (the
unread landing functions) and 784 (reading stack_native test source) have
dedicated selection checks, alongside Python imports, helper chains, deleted
dependencies and working-tree changes. These check selection, not the product
behavior asserted by those consumers.
