-- READ ONLY. Run against the selected Aiven schema before approval.
-- No private message bodies, references, filenames, users or credentials returned.
SELECT VERSION() AS server_version, @@lower_case_table_names AS lower_case_table_names,
       @@SESSION.lock_wait_timeout AS metadata_lock_wait_seconds;

SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME
FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE();

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION, TABLE_ROWS AS estimated_rows,
       DATA_LENGTH, INDEX_LENGTH
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
('messages','employermessages','conversations','employerconversations','conversationparticipants','message_send_requests');

SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE,
       CHARACTER_SET_NAME, COLLATION_NAME, COLUMN_KEY, EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND
((TABLE_NAME='messages' AND COLUMN_NAME IN ('file_url','file_name','file_mime','file_size')) OR
 (TABLE_NAME='employermessages' AND COLUMN_NAME IN ('attachment','file_name','file_mime','file_size')) OR
 TABLE_NAME='message_send_requests')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME, SUB_PART
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN
('messages','employermessages','conversations','employerconversations','conversationparticipants','message_send_requests')
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;

SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_NAME IN
('messages','employermessages','conversations','employerconversations','conversationparticipants')
ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION;

-- Exact counts scan tables. Capture while messaging writes are paused, and
-- repeat after DDL before accepting new traffic to compare preservation.
SELECT 'messages' AS table_name, COUNT(*) AS exact_rows FROM messages
UNION ALL SELECT 'employermessages', COUNT(*) FROM employermessages
UNION ALL SELECT 'conversations', COUNT(*) FROM conversations
UNION ALL SELECT 'employerconversations', COUNT(*) FROM employerconversations
UNION ALL SELECT 'conversationparticipants', COUNT(*) FROM conversationparticipants;

-- Aggregate attachment-reference checks only; no references or filenames.
-- Matching counts/lengths supplement the backup; they are not a content checksum.
SELECT 'messages' AS table_name, COUNT(*) AS exact_rows,
       SUM(file_url IS NOT NULL AND file_url <> '') AS attachment_rows,
       COALESCE(SUM(OCTET_LENGTH(file_url)),0) AS reference_bytes,
       COALESCE(MAX(OCTET_LENGTH(file_url)),0) AS longest_reference_bytes
FROM messages
UNION ALL
SELECT 'employermessages', COUNT(*), SUM(attachment IS NOT NULL AND attachment <> ''),
       COALESCE(SUM(OCTET_LENGTH(attachment)),0), COALESCE(MAX(OCTET_LENGTH(attachment)),0)
FROM employermessages;
