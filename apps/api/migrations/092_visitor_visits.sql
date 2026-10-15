-- 访客来源：不论是否注册，记录访客从哪个平台到站。
-- 口径：同一匿名访客同一天（北京时间）同一来源只记一条；明细由 worker 按保留期清理（默认 180 天）。
-- 不存 IP、完整来源 URL、User-Agent；visitor_id 是浏览器本地生成的随机 ID，不含个人信息。
CREATE TABLE IF NOT EXISTS visitor_visits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  visitor_id uuid NOT NULL,
  visit_day date NOT NULL,
  source text NOT NULL CHECK (source IN (
    'xiaohongshu', 'douyin', 'bilibili', 'zhihu', 'wechat', 'weibo', 'github',
    'search-baidu', 'search-google', 'search-bing', 'referral', 'direct', 'other'
  )),
  raw_source text,
  medium text,
  campaign text,
  content text,
  term text,
  referrer_host text,
  landing_path text,
  site text NOT NULL CHECK (site IN ('lindyson.com', 'lindyson.cn', 'other')),
  is_new_visitor boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (visitor_id, visit_day, source)
);
CREATE INDEX IF NOT EXISTS visitor_visits_created ON visitor_visits(created_at);
CREATE INDEX IF NOT EXISTS visitor_visits_source_created ON visitor_visits(source, created_at);

-- 注册时带上匿名访客 ID，便于把注册与之前的访问关联。
ALTER TABLE user_acquisitions ADD COLUMN IF NOT EXISTS visitor_id uuid;
CREATE INDEX IF NOT EXISTS user_acquisitions_visitor ON user_acquisitions(visitor_id) WHERE visitor_id IS NOT NULL;
