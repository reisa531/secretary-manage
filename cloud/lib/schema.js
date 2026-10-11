// PostgreSQL schema（内联，保证在 Vercel serverless 构建产物中可用）
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS members (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  gender TEXT DEFAULT '',
  birth_date TEXT DEFAULT '',
  nation TEXT DEFAULT '',
  native_place TEXT DEFAULT '',
  political_status TEXT DEFAULT '',
  join_league_date TEXT DEFAULT '',
  org_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  student_no TEXT DEFAULT '',
  major TEXT DEFAULT '',
  league_no TEXT DEFAULT '',
  league_role TEXT DEFAULT '',
  zhtj_url TEXT DEFAULT '',
  hobbies TEXT DEFAULT '',
  specialties TEXT DEFAULT '',
  skills TEXT DEFAULT '',
  volunteer_willing INTEGER DEFAULT 0,
  volunteer_types TEXT DEFAULT '',
  self_intro TEXT DEFAULT '',
  admin_notes TEXT DEFAULT '',
  portrait TEXT DEFAULT '',
  portrait_updated_at TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  type TEXT DEFAULT '团日活动',
  description TEXT DEFAULT '',
  location TEXT DEFAULT '',
  start_time TEXT DEFAULT '',
  end_time TEXT DEFAULT '',
  participant_ids JSONB DEFAULT '[]',
  notify_status TEXT DEFAULT '未通知',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS email_log (
  id SERIAL PRIMARY KEY,
  activity_id INTEGER,
  subject TEXT DEFAULT '',
  to_list TEXT DEFAULT '',
  status TEXT DEFAULT '',
  error TEXT DEFAULT '',
  sent_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS fee_periods (
  id SERIAL PRIMARY KEY,
  period TEXT NOT NULL,
  amount DOUBLE PRECISION NOT NULL DEFAULT 0,
  note TEXT DEFAULT '',
  status TEXT DEFAULT '收缴中',
  created_at TIMESTAMPTZ DEFAULT now(),
  notified_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS fee_records (
  id SERIAL PRIMARY KEY,
  period_id INTEGER NOT NULL REFERENCES fee_periods(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  status TEXT DEFAULT '未缴',
  order_no TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(period_id, member_id)
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT DEFAULT '',
  role TEXT DEFAULT 'admin',
  email_verified BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id SERIAL PRIMARY KEY,
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  purpose TEXT DEFAULT 'verify',
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS posts (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT DEFAULT '',
  category TEXT DEFAULT '通知',
  cover_url TEXT DEFAULT '',
  is_pinned BOOLEAN DEFAULT false,
  status TEXT DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS polls (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  poll_type TEXT DEFAULT 'single',
  multi_max INTEGER DEFAULT 1,
  is_anonymous BOOLEAN DEFAULT false,
  result_visibility TEXT DEFAULT 'always',
  allow_change_vote BOOLEAN DEFAULT false,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  status TEXT DEFAULT 'draft',
  published_at TIMESTAMPTZ,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS poll_options (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS poll_votes (
  id SERIAL PRIMARY KEY,
  poll_id INTEGER NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id INTEGER NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(poll_id, member_id, option_id)
);

CREATE INDEX IF NOT EXISTS idx_fee_records_period ON fee_records(period_id);
CREATE INDEX IF NOT EXISTS idx_poll_votes_poll ON poll_votes(poll_id);
CREATE INDEX IF NOT EXISTS idx_poll_options_poll ON poll_options(poll_id);
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status, is_pinned, published_at);
CREATE INDEX IF NOT EXISTS idx_polls_status ON polls(status, published_at);
`;
