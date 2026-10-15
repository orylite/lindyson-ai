-- 注册来源：记录用户第一次到站的推广参数与来源站点，供后台按平台统计注册与收入。
-- 单独建表而不给 users 加列：历史用户没有来源留空（后台显示「未知」），不影响 users 的大量 SELECT u.*。
CREATE TABLE IF NOT EXISTS user_acquisitions (
  user_id uuid PRIMARY KEY REFERENCES users(id),
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
  first_touch_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS user_acquisitions_source_created
  ON user_acquisitions(source, created_at DESC);
