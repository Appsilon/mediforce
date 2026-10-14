-- An Eval Run is signed once. The handler checks first; this makes two
-- concurrent signatures on the same run impossible rather than unlikely.

CREATE UNIQUE INDEX "step_qualifications_eval_run_uniq" ON "step_qualifications" USING btree ("eval_run_id");
