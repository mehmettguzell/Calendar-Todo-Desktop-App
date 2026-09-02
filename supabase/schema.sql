-- ==================================================================
-- TEMPO CALENDAR & TASK MANAGER: SUPABASE DATABASE SCHEMA
-- Multi-Platform Sync (Desktop & Mobile) + Auth + 14-Day Free Trial
-- ==================================================================

-- 1. Create Profiles Table (Linked to Supabase Auth)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Create Subscriptions Table (14-Day Trial + 7-Day Early Bird Discount)
CREATE TABLE IF NOT EXISTS public.subscriptions (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'TRIAL' CHECK (status IN ('TRIAL', 'PRO_ACTIVE', 'EXPIRED', 'CANCELLED')),
  plan_tier TEXT NOT NULL DEFAULT 'FREE' CHECK (plan_tier IN ('FREE', 'PRO_MONTHLY', 'PRO_ANNUAL', 'LIFETIME')),
  trial_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  trial_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '14 days'),
  early_bird_discount_ends_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  has_early_bird_discount BOOLEAN NOT NULL DEFAULT TRUE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Create Categories Table (Syncable across devices)
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

-- 4. Create Tasks Table (Syncable across devices)
CREATE TABLE IF NOT EXISTS public.tasks (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  category_id TEXT,
  parent_id TEXT,
  priority TEXT NOT NULL DEFAULT 'NONE' CHECK (priority IN ('NONE', 'LOW', 'MEDIUM', 'HIGH')),
  status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  due_date TEXT,
  end_date TEXT,
  all_day BOOLEAN NOT NULL DEFAULT TRUE,
  starts_at TIMESTAMPTZ,
  duration_sec INTEGER,
  start_time TEXT,
  end_time TEXT,
  recurrence JSONB,
  snoozed_until TEXT,
  completed_at TIMESTAMPTZ,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

-- 5. Create Focus Sessions Table (Syncable across devices)
CREATE TABLE IF NOT EXISTS public.focus_sessions (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  duration_sec INTEGER NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

-- 6. Create Occurrences Table (per-day state of a recurring series)
--    A recurring task is ONE row; ticking off Monday's run is state about that
--    day, and the task row cannot hold it. Without this table, completing a
--    repeat on the phone never reaches the desktop.
CREATE TABLE IF NOT EXISTS public.occurrences (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'TODO' CHECK (status IN ('TODO', 'IN_PROGRESS', 'COMPLETED')),
  completed_at TIMESTAMPTZ,
  snoozed_until TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS occurrences_user_task_idx
  ON public.occurrences (user_id, task_id);

-- 7. Create Reminders Table (syncable across devices)
CREATE TABLE IF NOT EXISTS public.reminders (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'RELATIVE' CHECK (kind IN ('RELATIVE', 'ABSOLUTE')),
  offset_minutes INTEGER,
  remind_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'FIRED', 'DISMISSED')),
  snoozed_until TEXT,
  last_fired_for TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS reminders_user_task_idx
  ON public.reminders (user_id, task_id);

-- 8. Task History (append-only activity trail, spec section 5.5)
--    Entries are never rewritten, so "which ids does the cloud not have" is the
--    whole diff. No conflict resolution is needed or wanted here.
CREATE TABLE IF NOT EXISTS public.task_history (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  kind TEXT NOT NULL,
  occurrence_date TEXT,
  field TEXT,
  from_value TEXT,
  to_value TEXT,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS task_history_user_task_idx
  ON public.task_history (user_id, task_id);

-- 9. Budget Categories (the "enum that grows")
--    Seeded with a useful set, then owned by the user: anything they type
--    becomes a permanent label of theirs, and syncs like everything else.
CREATE TABLE IF NOT EXISTS public.budget_categories (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  flow TEXT NOT NULL DEFAULT 'EXPENSE' CHECK (flow IN ('INCOME', 'EXPENSE', 'INVESTMENT')),
  color TEXT NOT NULL DEFAULT '#64748b',
  icon TEXT NOT NULL DEFAULT '.',
  built_in BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

-- 10. Transactions (income, expense, investment)
--    `amount_minor` is an INTEGER in minor units - kurus, cents. Storing money
--    as a float is how monthly totals end up a few kurus off, and a budget that
--    does not add up is a budget nobody trusts twice.
CREATE TABLE IF NOT EXISTS public.transactions (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  flow TEXT NOT NULL DEFAULT 'EXPENSE' CHECK (flow IN ('INCOME', 'EXPENSE', 'INVESTMENT')),
  category_id TEXT,
  note TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS transactions_user_date_idx
  ON public.transactions (user_id, date);

-- 10b. Wishlist (things the user means to buy)
--    Not money: nothing here is in any total. It becomes a row in
--    `transactions` only when the user says they bought it.
CREATE TABLE IF NOT EXISTS public.wishlist (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  price_minor BIGINT,
  url TEXT,
  note TEXT,
  category_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  bought_at TIMESTAMPTZ,
  transaction_id TEXT,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

-- 10c. Deadlines (the dated checkpoints a task is broken into)
--    Distinct from tasks.deadline, which is the one day the task itself stops
--    being on time. A project reaches that day through several of its own, and
--    each is a row so two devices can tick two of them without either losing
--    the other. Removal is `is_deleted`, not a DELETE: undo has to be able to
--    put one back.
CREATE TABLE IF NOT EXISTS public.deadlines (
  id TEXT NOT NULL,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  task_id TEXT NOT NULL,
  label TEXT NOT NULL,
  date TEXT NOT NULL,
  completed_at TIMESTAMPTZ,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, user_id)
);

CREATE INDEX IF NOT EXISTS deadlines_user_task_idx
  ON public.deadlines (user_id, task_id);

-- 11. Backfill columns added after the first release.
--    Re-runnable: `IF NOT EXISTS` makes this safe on an existing project.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS end_date TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS estimate_minutes INTEGER;
-- The day a task has to be finished by. Distinct from end_date, which is the
-- last day of a multi-day run: a deadline is a point, a span is a stretch.
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS deadline TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS recurrence JSONB;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS recurrence_source_id TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS last_generated_for TEXT;
-- Statement import: who was paid, and the identity of the statement row it came
-- from. The unique index is what makes re-importing the same month a no-op.
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS merchant TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS external_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS transactions_user_external_idx
  ON public.transactions (user_id, external_id)
  WHERE external_id IS NOT NULL;
-- Instalments: how many monthly charges a purchase is split into. The row
-- keeps the whole price; the months it lands in are worked out from this.
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS instalments INTEGER;
ALTER TABLE public.budget_categories ADD COLUMN IF NOT EXISTS monthly_limit_minor BIGINT;

-- ==================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures each user can ONLY access and modify their own data
-- ==================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.occurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.budget_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wishlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deadlines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_history ENABLE ROW LEVEL SECURITY;

-- Profiles Policies
-- NOTE: the INSERT policy is required. public.tasks.user_id has a FK onto
-- public.profiles, so the client must be able to create its own missing
-- profile row (accounts predating the signup trigger) before any task can
-- be written. Without it every upsert here fails with an RLS violation and
-- task sync silently stops.
DROP POLICY IF EXISTS "Users can view own profile" ON public.profiles;
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Subscriptions Policies
DROP POLICY IF EXISTS "Users can view own subscription" ON public.subscriptions;
CREATE POLICY "Users can view own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own subscription" ON public.subscriptions;
CREATE POLICY "Users can insert own subscription"
  ON public.subscriptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own subscription" ON public.subscriptions;
CREATE POLICY "Users can update own subscription"
  ON public.subscriptions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Categories Policies
DROP POLICY IF EXISTS "Users can select own categories" ON public.categories;
CREATE POLICY "Users can select own categories"
  ON public.categories FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own categories" ON public.categories;
CREATE POLICY "Users can insert own categories"
  ON public.categories FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own categories" ON public.categories;
CREATE POLICY "Users can update own categories"
  ON public.categories FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own categories" ON public.categories;
CREATE POLICY "Users can delete own categories"
  ON public.categories FOR DELETE
  USING (auth.uid() = user_id);

-- Tasks Policies
DROP POLICY IF EXISTS "Users can select own tasks" ON public.tasks;
CREATE POLICY "Users can select own tasks"
  ON public.tasks FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own tasks" ON public.tasks;
CREATE POLICY "Users can insert own tasks"
  ON public.tasks FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own tasks" ON public.tasks;
CREATE POLICY "Users can update own tasks"
  ON public.tasks FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own tasks" ON public.tasks;
CREATE POLICY "Users can delete own tasks"
  ON public.tasks FOR DELETE
  USING (auth.uid() = user_id);

-- Focus Sessions Policies
DROP POLICY IF EXISTS "Users can select own focus sessions" ON public.focus_sessions;
CREATE POLICY "Users can select own focus sessions"
  ON public.focus_sessions FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own focus sessions" ON public.focus_sessions;
CREATE POLICY "Users can insert own focus sessions"
  ON public.focus_sessions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own focus sessions" ON public.focus_sessions;
CREATE POLICY "Users can update own focus sessions"
  ON public.focus_sessions FOR UPDATE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own focus sessions" ON public.focus_sessions;
CREATE POLICY "Users can delete own focus sessions"
  ON public.focus_sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Occurrences & Reminders Policies
-- Generated in a loop: the four policies are identical for both tables, and
-- writing them out twice is eight places for them to drift apart.
DO $$
DECLARE
  t TEXT;
  op TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['occurrences', 'reminders', 'budget_categories', 'transactions', 'wishlist', 'deadlines', 'task_history']
  LOOP
    FOREACH op IN ARRAY ARRAY['select', 'insert', 'update', 'delete']
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS "own %s %s" ON public.%I', t, op, t);
      IF op = 'insert' THEN
        EXECUTE format(
          'CREATE POLICY "own %s %s" ON public.%I FOR INSERT WITH CHECK (auth.uid() = user_id)',
          t, op, t);
      ELSE
        EXECUTE format(
          'CREATE POLICY "own %s %s" ON public.%I FOR %s USING (auth.uid() = user_id)',
          t, op, t, upper(op));
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- ==================================================================
-- AUTOMATIC REGISTRATION TRIGGER
-- When a user signs up with Google OAuth or Email, automatically:
-- 1. Create a `profiles` entry
-- 2. Create a `subscriptions` entry with 14-day trial & 7-day early bird discount
-- ==================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Insert profile
  INSERT INTO public.profiles (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture', NULL)
  );

  -- Insert subscription with 14-day trial and 7-day early bird discount
  INSERT INTO public.subscriptions (
    user_id,
    status,
    plan_tier,
    trial_started_at,
    trial_ends_at,
    early_bird_discount_ends_at,
    has_early_bird_discount
  )
  VALUES (
    NEW.id,
    'TRIAL',
    'FREE',
    NOW(),
    NOW() + INTERVAL '14 days',
    NOW() + INTERVAL '7 days',
    TRUE
  );

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Bind trigger to auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ==================================================================
-- REALTIME PUBLICATION SETUP
-- Enable instantaneous cross-device sync (Desktop ↔ Mobile)
-- ==================================================================

-- Re-runnable: ADD TABLE errors if the table is already published.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['profiles', 'subscriptions', 'categories', 'tasks', 'focus_sessions', 'occurrences', 'reminders', 'budget_categories', 'transactions', 'wishlist', 'deadlines']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

