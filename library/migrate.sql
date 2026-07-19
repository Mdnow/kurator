-- Миграция для活 библиотеки (Куратор v2)
-- Выполнить в Supabase SQL Editor: https://supabase.com/dashboard/project/pqngmvixfcsrvsvrtbfj/sql

ALTER TABLE notes ADD COLUMN IF NOT EXISTS note_type text DEFAULT 'impulse';
ALTER TABLE notes ADD COLUMN IF NOT EXISTS territory text;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS connections jsonb DEFAULT '[]'::jsonb;

-- Обновляем существующие заметки: короткие = impulse, длинные = essay
UPDATE notes SET note_type = CASE WHEN length(content) > 500 THEN 'essay' ELSE 'impulse' END WHERE note_type IS NULL;
