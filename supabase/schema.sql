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

-- ==================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- Ensures each user can ONLY access and modify their own data
-- ==================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.focus_sessions ENABLE ROW LEVEL SECURITY;

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
  FOREACH t IN ARRAY ARRAY['profiles', 'subscriptions', 'categories', 'tasks', 'focus_sessions']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

