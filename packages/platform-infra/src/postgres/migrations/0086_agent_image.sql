-- An Agent may name the image it runs in; a Step that names none is given it
-- when its Workflow is saved, and an Agent's Eval Run runs in it.
--
-- Additive and nullable: an agent without one runs in the golden image.
ALTER TABLE "agents" ADD COLUMN "image" text;
