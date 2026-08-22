-- 此间 / Amid 原始对话同步升级
-- 在 Supabase Dashboard -> SQL Editor 中执行一次。
-- 保留 chat_messages_claude 现有记录，只增加此间需要的字段、索引与私有语音桶。

alter table public.chat_messages_claude
  add column if not exists amid_message_id text,
  add column if not exists source_type text,
  add column if not exists conversation_mode text,
  add column if not exists input_mode text,
  add column if not exists delivery_mode text,
  add column if not exists transcript_source text,
  add column if not exists local_date date,
  add column if not exists local_time time,
  add column if not exists audio_path text,
  add column if not exists audio_mime text,
  add column if not exists audio_duration_ms integer,
  add column if not exists updated_at timestamptz,
  add column if not exists deleted_at timestamptz;

create unique index if not exists chat_messages_claude_amid_message_id_uq
  on public.chat_messages_claude (amid_message_id);

create index if not exists chat_messages_claude_created_at_idx
  on public.chat_messages_claude (created_at);

create extension if not exists pg_trgm;

create index if not exists chat_messages_claude_content_trgm_idx
  on public.chat_messages_claude using gin (content gin_trgm_ops);

insert into storage.buckets (id, name, public)
values ('amid-chat-audio', 'amid-chat-audio', false)
on conflict (id) do update set public = false;

grant select, insert on table public.chat_messages_claude to anon;

-- Publishable key 只保留读取与新增能力。编辑、软删除和私有音频写入由
-- 此间服务端保存的 sb_secret_... 密钥完成，不要给 anon 开放 UPDATE/DELETE。
