-- Every tags field now takes new tags while writing (there's no longer a setting for it), so mark
-- existing tags fields open. Other fields, and the order of fields, stay as they are.
UPDATE users SET fields_json = (
  SELECT json_group_array(CASE WHEN json_extract(value, '$.kind') = 'tags' THEN json_set(value, '$.open', json('true')) ELSE json(value) END)
  FROM (SELECT key, value FROM json_each(users.fields_json) ORDER BY key)
)
WHERE fields_json != '[]';
