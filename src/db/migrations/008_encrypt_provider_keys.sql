-- Flag for encrypted provider keys
ALTER TABLE providers ADD COLUMN key_encrypted INTEGER DEFAULT 0;
