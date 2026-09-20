-- ------------------------------
-- day_closing: shift linkage
-- ------------------------------
-- Lets multiple closings coexist for the same closing-cycle window (one per
-- shift) instead of every closing in the window sharing a single record.

DEFINE FIELD shift ON day_closing TYPE option<record<shift>> PERMISSIONS FULL;
