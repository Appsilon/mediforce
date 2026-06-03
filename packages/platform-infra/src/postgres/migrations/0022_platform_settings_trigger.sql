CREATE TRIGGER platform_settings_set_updated_at
	BEFORE UPDATE ON "platform_settings"
	FOR EACH ROW EXECUTE FUNCTION set_updated_at();
