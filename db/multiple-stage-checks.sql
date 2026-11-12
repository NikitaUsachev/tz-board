-- Extend existing checklist validation without changing access rules or old stage IDs.
DO $upgrade$
DECLARE original text; updated text;
BEGIN
 SELECT pg_get_functiondef('public.set_check(text,text,boolean,text)'::regprocedure) INTO original;
 IF position('$.blocks.*.*.stages[*]' in original)>0 THEN RETURN; END IF;
 updated := replace(original,
 'and jsonb_path_exists(d,''$.blocks.*.*.spec ? (@.id == $i)'',jsonb_build_object(''i'',split_part(p_item,'':'',1))))',
 'and (jsonb_path_exists(d,''$.blocks.*.*.spec ? (@.id == $i)'',jsonb_build_object(''i'',split_part(p_item,'':'',1)))
 or jsonb_path_exists(d,''$.blocks.*.*.stages[*] ? (@.id == $i)'',jsonb_build_object(''i'',split_part(p_item,'':'',1)))))');
 IF updated=original THEN RAISE EXCEPTION 'Unexpected set_check definition; review required'; END IF;
 EXECUTE updated;
END $upgrade$;