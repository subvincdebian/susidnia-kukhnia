export const tables=['restaurants','menu_items','customers','couriers','orders','order_items','reviews','payments'];
export async function schemaSignature(db) {
  const owned=tables;
  const [columns,constraints,indexes,triggers,functions,views]=await Promise.all([
    db.query("SELECT table_name,column_name,ordinal_position,column_default,is_nullable,data_type,character_maximum_length,numeric_precision,numeric_scale,datetime_precision,is_identity,identity_generation FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1) ORDER BY table_name,ordinal_position",[owned]),
    db.query("SELECT c.relname AS table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1) ORDER BY c.relname,k.conname",[owned]),
    db.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1) ORDER BY tablename,indexname",[owned]),
    db.query("SELECT c.relname AS table_name,t.tgname,t.tgenabled,pg_get_triggerdef(t.oid) AS definition FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1) AND NOT t.tgisinternal ORDER BY c.relname,t.tgname",[owned]),
    db.query("SELECT p.proname,pg_get_functiondef(p.oid) AS definition FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=ANY($1) ORDER BY p.proname",[['check_review_order','complete_order','guard_order_item','recalculate_order','guard_order_update','guard_payment']]),
    db.query("SELECT viewname,definition FROM pg_views WHERE schemaname='public' AND viewname='active_orders' ORDER BY viewname")
  ]);
  for(const row of functions.rows) {
    row.definition=row.definition.replace(/\r\n/g,'\n');
    if(row.proname==='complete_order')row.definition=row.definition.replace('        -- Повторне натискання не додає другу оплату.\n','');
  }
  return Object.fromEntries([columns,constraints,indexes,triggers,functions,views].map((r,i)=>[['columns','constraints','indexes','triggers','functions','views'][i],r.rows]));
}
