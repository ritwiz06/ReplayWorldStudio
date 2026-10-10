"""Language assistance (GEN-01): typed object proposals and bounded edit intents.

A provider (ASU Voyager, or recorded answers in tests) drafts; this package checks the answer
against the schema, the user's own words and the scene before anything reaches the user. It
never changes a project and never runs model output as code.
"""
