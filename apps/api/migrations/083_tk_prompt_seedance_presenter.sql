-- TK Prompt Engine 1.0：live_presenter 改由 Seedance 自动生成虚构主持人。
-- 082 已在生产执行，必须保持不可变；本迁移只收紧未来写入，不修改历史迁移。

ALTER TABLE tk_prompt_options
  DROP CONSTRAINT IF EXISTS tk_prompt_options_content_shape_check;

ALTER TABLE tk_prompt_options
  ADD CONSTRAINT tk_prompt_options_content_shape_check CHECK (
    content_purged_at IS NOT NULL
    OR (
      strategy_blueprint IS NOT NULL
      AND jsonb_typeof(strategy_blueprint) = 'object'
      AND (plan IS NULL OR jsonb_typeof(plan) = 'object')
      AND coalesce(strategy_blueprint ->> 'slot' = slot, false)
      AND coalesce(
        strategy_blueprint ->> 'videoMode' IN (
          'product_closeup', 'scene_demo', 'live_presenter'
        ),
        false
      )
      AND coalesce(
        strategy_blueprint ->> 'proofMethodId' IN (
          'visible_operation',
          'structure_closeup',
          'context_demo',
          'verified_comparison',
          'verified_before_after',
          'presenter_delivery'
        ),
        false
      )
      AND NOT (strategy_blueprint ? 'authorizedActorAssetId')
    )
  );

ALTER TABLE tk_prompt_generations
  DROP CONSTRAINT IF EXISTS tk_prompt_generations_seedance_presenter_shape_check;

ALTER TABLE tk_prompt_generations
  ADD CONSTRAINT tk_prompt_generations_seedance_presenter_shape_check CHECK (
    content_purged_at IS NOT NULL
    OR (
      NOT coalesce(confirmed_fact_pack ? 'actorSnapshot', false)
      AND NOT coalesce(
        (creative_input #> '{appearance}') ? 'authorizedActorAssetId',
        false
      )
      AND NOT jsonb_path_exists(
        coalesce(strategy_set, '[]'::jsonb),
        '$[*].authorizedActorAssetId'
      )
    )
  );

COMMENT ON CONSTRAINT tk_prompt_options_content_shape_check ON tk_prompt_options IS
  'TK 方案只保存商品与创意策略；live_presenter 由 Seedance 自动生成，不接受演员素材 ID。';

COMMENT ON CONSTRAINT tk_prompt_generations_seedance_presenter_shape_check ON tk_prompt_generations IS
  'TK generation 的确认事实、创意输入和策略集合均禁止保存旧授权演员快照或素材 ID。';
