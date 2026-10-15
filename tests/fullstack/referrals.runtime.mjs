import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
process.env.RESEND_API_KEY = '';
const { pool, withTransaction } = await import('/app/apps/api/dist/db/pool.js');
const { bindReferralWithClient, getReferralSummary, listReferrals, checkReferralCode, lockReferralUsersWithClient, revokeReferralForOrderWithClient, resolveReferralWithClient } = await import('/app/apps/api/dist/domain/referrals.js');
const { markOrderPaid, applyRefundResult, queueOrderRefundWithClient } = await import('/app/apps/api/dist/domain/ordersService.js');
const { setUserAvailableCreditsWithClient } = await import('/app/apps/api/dist/domain/financialCredits.js');
const { holdGenerationLotsWithClient, releaseGenerationLotsWithClient, settleGenerationLotsWithClient } = await import('/app/apps/api/dist/domain/generationCredits.js');
const { failTaskWithRefund, finalizeRequestedTaskCancellation } = await import('/app/apps/api/dist/domain/generationService.js');
const { holdPromptWizardCreditsWithClient, releasePromptWizardCreditsWithClient } = await import('/app/apps/api/dist/domain/promptWizardCredits.js');
const { holdTkPromptCreditsWithClient, releaseTkPromptCreditsWithClient } = await import('/app/apps/api/dist/domain/tkPromptEngineCredits.js');
const { buildApp } = await import('/app/apps/api/dist/app.js');
const { hashVerificationCode } = await import('/app/apps/api/dist/auth/verificationTokens.js');
const prefix = 'referral-' + randomUUID();
const app = buildApp();
app.addHook('onError', async (_request, _reply, error) => { if ((error.statusCode ?? 500) >= 500) console.error(error); });
const userIds = [];
const revisionId = randomUUID();
await pool.query(`INSERT INTO payment_channel_revisions(id,provider,revision,enabled,api_base,mch_no,app_id,desktop_way_code,mobile_way_code)
  VALUES($1,$2,1,false,'http://localhost','test','test','ALI_WAP','ALI_WAP')`,[revisionId,prefix]);
async function user() {
  const id = randomUUID(); userIds.push(id);
  await pool.query('INSERT INTO users(id,email,password_hash,user_name) VALUES ($1,$2,$3,$4)', [id, `${id}@lindyson.test`, 'test-no-login', prefix]);
  return id;
}
async function invited(inviter) {
  const invitee = await user();
  const code = (await getReferralSummary(inviter)).code;
  await withTransaction(c => bindReferralWithClient(c, invitee, code));
  return invitee;
}
async function order(userId, kind = 'main', billing = 'monthly') {
  const id = randomUUID(), attempt = randomUUID();
  await withTransaction(async c => {
    await c.query(`INSERT INTO orders(id,user_id,kind,plan_name,amount,billing,credit_amount,credit_bucket,payment_provider,merchant_order_no)
      VALUES ($1,$2,$3,'邀约测试套餐',100,$4,100,$5,'jeepay',$6)`, [id,userId,kind,billing,kind,id]);
    await c.query(`INSERT INTO payment_attempts(id,order_id,attempt,idempotency_key,request_hash,merchant_order_no,amount,surface,way_code,status,channel_revision_id)
      VALUES ($1,$2,1,$3,$3,$3,100,'pc','ALI_WAP','queued',$4)`, [attempt,id,id,revisionId]);
    await c.query('UPDATE orders SET current_payment_attempt_id=$2 WHERE id=$1', [id,attempt]);
  });
  return { id, attempt, userId };
}
async function pay(o) { return markOrderPaid(o.id, 'provider-' + o.id, o.attempt); }
async function lots(userId) { return (await pool.query("SELECT * FROM credit_lots WHERE user_id=$1 AND source_type='referral-reward' ORDER BY created_at", [userId])).rows; }
async function revoke(o) {
  await withTransaction(async c => {
    await c.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE', [o.id]);
    await lockReferralUsersWithClient(c, o.userId);
    await revokeReferralForOrderWithClient(c, o.id);
  });
}
async function taskHold(userId, amount, kind = 'video') {
  const taskId = randomUUID();
  await withTransaction(async c => {
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    await c.query(`INSERT INTO generation_tasks(id,user_id,kind,model,prompt,credits,reserved_credits,addon_credits_used,credit_status,status) VALUES ($1,$2,$3,'referral-test','test',$4,$4,$4,'held','processing')`, [taskId,userId,kind,amount]);
    await holdGenerationLotsWithClient({client:c,userId,taskId,attempt:0,mainAmount:0,addonAmount:amount});
    await setUserAvailableCreditsWithClient(c,userId);
  });
  return taskId;
}
try {
  const savedSettings = (await pool.query('SELECT * FROM referral_settings')).rows[0];
  await pool.query('UPDATE referral_settings SET enabled=true, inviter_credits=500, invitee_credits=500');
  const legacyInviter='00000000-0000-4000-8000-000000008600';
  const legacySummary=await getReferralSummary(legacyInviter);
  assert.match(legacySummary.code,/^[A-Z0-9]{8}$/);
  assert.equal((await checkReferralCode(pool,'legacy-referral-code-2026')).user_id,legacyInviter);
  assert.equal((await checkReferralCode(pool,legacySummary.code)).user_id,legacyInviter);
  assert.equal((await checkReferralCode(pool,'_NSW82ah')).user_id,legacyInviter);
  assert.equal((await getReferralSummary('00000000-0000-4000-8000-000000008700')).code,'AB12CD34');
  const shortLegacyInvitee=await user();
  await withTransaction(c=>bindReferralWithClient(c,shortLegacyInvitee,'_NSW82ah'));
  assert.equal((await pool.query('SELECT inviter_id FROM referrals WHERE invitee_id=$1',[shortLegacyInvitee])).rows[0].inviter_id,legacyInviter);
  const legacyInvitee=await user();
  await withTransaction(c=>bindReferralWithClient(c,legacyInvitee,'legacy-referral-code-2026'));
  assert.equal((await pool.query('SELECT inviter_id FROM referrals WHERE invitee_id=$1',[legacyInvitee])).rows[0].inviter_id,legacyInviter);
  const inviter = await user();
  const code = (await getReferralSummary(inviter)).code;
  assert.match(code,/^[A-Z0-9]{8}$/);
  assert.equal(code, (await getReferralSummary(inviter)).code);
  const concurrentCodes=await Promise.all(Array.from({length:8},()=>getReferralSummary(inviter)));
  assert.ok(concurrentCodes.every(summary=>summary.code===code));
  await assert.rejects(withTransaction(c=>bindReferralWithClient(c,inviter,code)));
  const verificationId = randomUUID(), salt = 'test-salt', email = `${randomUUID()}@lindyson.test`;
  await pool.query(`INSERT INTO registration_verification_codes(id,email,user_name,code_hash,code_salt,expires_at)
    VALUES ($1,$2,'邀约注册验证',$3,$4,now()+interval '10 minutes')`, [verificationId,email,hashVerificationCode('123456',salt),salt]);
  const payload = {userName:'邀约注册验证',email,password:'ReferralTest2026',verificationId,verificationCode:'000000',referralCode:code};
  const badRegistration = await app.inject({method:'POST',url:'/api/auth/register',payload});
  assert.equal(badRegistration.statusCode,400,badRegistration.body);
  assert.equal((await pool.query('SELECT id FROM users WHERE email=$1',[email])).rowCount,0);
  const invalidInvitation=await app.inject({method:'POST',url:'/api/auth/register',payload:{...payload,verificationCode:'123456',referralCode:'not-a-real-code-123456789'}});
  assert.equal(invalidInvitation.statusCode,409,invalidInvitation.body);
  assert.equal((await pool.query('SELECT id FROM users WHERE email=$1',[email])).rowCount,0);
  assert.equal((await pool.query('SELECT consumed_at FROM registration_verification_codes WHERE id=$1',[verificationId])).rows[0].consumed_at,null);
  const registration = await app.inject({method:'POST',url:'/api/auth/register',payload:{...payload,verificationCode:'123456'}});
  assert.equal(registration.statusCode,200,registration.body);
  const firstUser=registration.json().user.id; userIds.push(firstUser);
  await assert.rejects(withTransaction(c=>bindReferralWithClient(c,firstUser,code)));
  const cookie=[registration.headers['set-cookie']].flat()[0].split(';')[0];
  assert.equal((await app.inject({method:'GET',url:'/api/account/referrals/summary',headers:{cookie}})).statusCode,200);
  assert.equal((await app.inject({method:'GET',url:'/api/admin/referrals',headers:{cookie}})).statusCode,403);
  const adminIdentity=(await pool.query("SELECT id,email,auth_version FROM users WHERE role='admin' ORDER BY id LIMIT 1")).rows[0];
  const adminCookie='lindyson_session='+app.jwt.sign({id:adminIdentity.id,email:adminIdentity.email,role:'admin',authVersion:adminIdentity.auth_version});
  const adminHeaders={cookie:adminCookie,'idempotency-key':randomUUID()};
  const settingsBody={enabled:true,inviterCredits:500,inviteeCredits:500,reason:'真实接口幂等测试'};
  const mutation=()=>app.inject({method:'PATCH',url:'/api/admin/referral-settings',headers:adminHeaders,payload:settingsBody});
  assert.equal((await mutation()).statusCode,200);
  const replay=await mutation(); assert.equal(replay.statusCode,200); assert.equal(replay.headers['idempotency-replayed'],'true');
  assert.equal((await app.inject({method:'PATCH',url:'/api/admin/referral-settings',headers:adminHeaders,payload:{...settingsBody,inviterCredits:501}})).statusCode,409);
  assert.equal((await app.inject({method:'PATCH',url:'/api/admin/referral-settings',headers:{cookie},payload:settingsBody})).statusCode,403);
  assert.equal((await pool.query("SELECT id FROM audit_logs WHERE module='邀约奖励' AND detail LIKE '%真实接口幂等测试%'" )).rowCount,1);
  // 改价和关闭不会改变已绑定邀请。
  await pool.query('UPDATE referral_settings SET enabled=false, inviter_credits=900, invitee_credits=800');
  assert.equal(await checkReferralCode(pool,code),null);
  await assert.rejects(withTransaction(c=>bindReferralWithClient(c,firstUser,code)));
  const addon=await order(firstUser,'addon','one-time'); await pay(addon);
  assert.equal((await lots(firstUser)).length,0);
  const first=await order(firstUser), concurrent=await order(firstUser,'main','yearly');
  await Promise.all([pay(first),pay(concurrent),pay(first)]);
  assert.equal((await lots(firstUser)).length,1);
  assert.equal((await lots(inviter))[0].original_amount,500);
  assert.equal((await lots(firstUser))[0].original_amount,500);
  const relation=(await pool.query('SELECT * FROM referrals WHERE invitee_id=$1',[firstUser])).rows[0];
  const winning=relation.order_id===first.id?first:concurrent;
  const failed=await taskHold(inviter,120), succeeded=await taskHold(inviter,80), canceled=await taskHold(inviter,50,'image');
  await revoke(winning); await revoke(winning);
  let lot=(await lots(inviter))[0];
  assert.equal(lot.available_amount,0); assert.equal(lot.reversed_amount,250); assert.equal(lot.held_amount,250);
  const failure={ok:false,category:'provider-failed',reason:'邀约积分回收测试',terminal:true};
  const failedTask=await failTaskWithRefund(failed,failure);
  assert.equal(failedTask.creditStatus,'refunded'); assert.equal(failedTask.refundedCredits,0);
  assert.equal((await failTaskWithRefund(failed,failure)).refundedCredits,0);
  const token=randomUUID();
  await pool.query('UPDATE generation_tasks SET claim_token=$2,cancel_requested_at=now() WHERE id=$1',[canceled,token]);
  const canceledTask=await finalizeRequestedTaskCancellation(canceled,0,token,failure);
  assert.equal(canceledTask.status,'canceled'); assert.equal(canceledTask.refundedCredits,0);
  await withTransaction(async c=>{
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[inviter]);
    assert.deepEqual(await releaseGenerationLotsWithClient(c,failed,0),{mainReturned:0,addonReturned:0,expiredAmount:0,revokedAmount:120});
    await releaseGenerationLotsWithClient(c,failed,0);
    await settleGenerationLotsWithClient(c,succeeded,0);
    await setUserAvailableCreditsWithClient(c,inviter);
  });
  lot=(await lots(inviter))[0];
  assert.equal(lot.reversed_amount,420); assert.equal(lot.consumed_amount,80); assert.equal(lot.held_amount,0);
  let records=await listReferrals({},inviter);
  assert.equal(records.items[0].status,'review'); assert.match(records.items[0].invitee,/\*\*\*/);
  const closeHeaders={cookie:adminCookie,'idempotency-key':randomUUID()};
  const closeReview=()=>app.inject({method:'POST',url:`/api/admin/referrals/${relation.id}/resolve`,headers:closeHeaders,payload:{action:'close',reason:'测试核对，保留已消费奖励'}});
  const closed=await closeReview(); assert.equal(closed.statusCode,200,closed.body);
  assert.equal((await closeReview()).headers['idempotency-replayed'],'true');
  assert.equal((await pool.query("SELECT id FROM audit_logs WHERE module='邀约奖励' AND action='核对结案' AND target=$1",[relation.id])).rowCount,1);
  assert.equal((await listReferrals({},inviter)).items[0].status,'closed');
  await pay(await order(firstUser)); assert.equal((await lots(firstUser)).length,1);
  await pool.query('UPDATE referral_settings SET enabled=true, inviter_credits=500, invitee_credits=500');
  // 冻结账户保留待发奖励，恢复后人工补发，双人原子入账。
  const pendingUser=await invited(inviter); const pendingOrder=await order(pendingUser,'main','yearly');
  await pool.query("UPDATE users SET status='frozen' WHERE id=$1",[inviter]);
  await pay(pendingOrder); assert.equal((await lots(pendingUser)).length,0);
  const pendingRelation=(await pool.query('SELECT id FROM referrals WHERE invitee_id=$1',[pendingUser])).rows[0].id;
  await assert.rejects(withTransaction(c=>resolveReferralWithClient(c,pendingRelation,'grant','冻结时不可补发')));
  await pool.query("UPDATE users SET status='active' WHERE id=$1",[inviter]);
  await withTransaction(c=>resolveReferralWithClient(c,pendingRelation,'grant','恢复后补发'));
  await withTransaction(c=>resolveReferralWithClient(c,pendingRelation,'grant','重放补发'));
  assert.equal((await lots(pendingUser)).length,1);
  // 真实退款状态机：排队/失败不撤销，成功回调撤销奖励。
  const refundUser=await invited(inviter), refundOrder=await order(refundUser);
  await pay(refundOrder);
  const admin=(await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1")).rows[0].id;
  await withTransaction(c=>queueOrderRefundWithClient(c,refundOrder.id,admin,'127.0.0.1'));
  assert.equal((await lots(refundUser))[0].referral_revoked_at,null);
  const failedRefund=(await pool.query('SELECT merchant_refund_no FROM orders WHERE id=$1',[refundOrder.id])).rows[0];
  await applyRefundResult(refundOrder.id,{mchRefundNo:failedRefund.merchant_refund_no,state:3,refundOrderId:'failed-'+refundOrder.id,refundAmount:100});
  assert.equal((await lots(refundUser))[0].referral_revoked_at,null);
  await withTransaction(c=>queueOrderRefundWithClient(c,refundOrder.id,admin,'127.0.0.1'));
  const refundRow=(await pool.query('SELECT merchant_refund_no FROM orders WHERE id=$1',[refundOrder.id])).rows[0];
  await applyRefundResult(refundOrder.id,{mchRefundNo:refundRow.merchant_refund_no,state:2,refundOrderId:'refund-'+refundOrder.id,refundAmount:100});
  assert.ok((await lots(refundUser))[0].referral_revoked_at);
  // V6 历史批次同样不能通过到期补偿恢复撤销奖励。
  const wizardInviter=await user(), wizardUser=await invited(wizardInviter), wizardOrder=await order(wizardUser); await pay(wizardOrder);
  const wizardRun=randomUUID(), wizardBatch=randomUUID(), imageId=randomUUID();
  await withTransaction(async c=>{
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[wizardInviter]);
    await c.query(`INSERT INTO prompt_wizard_runs(id,user_id,status,revision,image_asset_ids,product_profile,engine_version)
      VALUES($1,$2,'ready',1,ARRAY[$3::uuid],'{}',4)`,[wizardRun,wizardInviter,imageId]);
    await c.query(`INSERT INTO prompt_wizard_batches(id,run_id,user_id,ordinal,idempotency_key,request_hash,run_revision,status,is_free,credits,credit_status,main_credits_used,addon_credits_used,image_asset_ids,product_profile,creative_brief,video_config,attempt_count)
      VALUES($1::uuid,$2,$3,1,$1::text,'referral-test',1,'processing',false,100,'held',0,100,ARRAY[$4::uuid],'{}','{}','{}',1)`,[wizardBatch,wizardRun,wizardInviter,imageId]);
    await holdPromptWizardCreditsWithClient({client:c,userId:wizardInviter,batchId:wizardBatch,mainAmount:0,addonAmount:100});
  });
  await revoke(wizardOrder);
  for (let i=0;i<2;i++) await withTransaction(async c=>{
    assert.deepEqual(await releasePromptWizardCreditsWithClient(c,wizardInviter,wizardBatch),{returnedCredits:0,expiredCredits:0,reissuedCredits:0});
  });
  assert.equal((await lots(wizardInviter))[0].reversed_amount,500);
  // TK 批次预扣来自奖励，失败不得走全额补偿绕过撤销。
  const tkInviter=await user(), tkUser=await invited(tkInviter), tkOrder=await order(tkUser); await pay(tkOrder);
  const runId=randomUUID(), generationId=randomUUID();
  await withTransaction(async c=>{
    await c.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[tkInviter]);
    await c.query(`INSERT INTO tk_prompt_runs(id,user_id,idempotency_key,request_hash,image_asset_ids)
      VALUES($1::uuid,$2::uuid,$1::text,$3,ARRAY[$4::uuid])`,[runId,tkInviter,'a'.repeat(64),randomUUID()]);
    await c.query(`INSERT INTO tk_prompt_generations(id,run_id,user_id,ordinal,idempotency_key,request_hash,confirmed_fact_pack,creative_input,video_config,credits,credit_status,addon_credits_used)
      VALUES($1::uuid,$2::uuid,$3::uuid,1,$1::text,$4,'{}','{}','{}',100,'held',100)`,[generationId,runId,tkInviter,'a'.repeat(64)]);
    await holdTkPromptCreditsWithClient({client:c,userId:tkInviter,generationId,mainAmount:0,addonAmount:100});
  });
  await revoke(tkOrder);
  await withTransaction(async c=>{
    const released=await releaseTkPromptCreditsWithClient(c,tkInviter,generationId);
    assert.deepEqual(released,{returned:0,compensated:0,revoked:100});
    assert.deepEqual(await releaseTkPromptCreditsWithClient(c,tkInviter,generationId),released);
  });
  assert.equal((await lots(tkInviter))[0].reversed_amount,500);
  // 回滚不会留下半边奖励。
  const rollbackUser=await invited(inviter), rollbackOrder=await order(rollbackUser);
  const {rewardReferralForOrderWithClient}=await import('/app/apps/api/dist/domain/referrals.js');
  await assert.rejects(withTransaction(async c=>{await lockReferralUsersWithClient(c,rollbackUser); await rewardReferralForOrderWithClient(c,{...rollbackOrder,user_id:rollbackUser,kind:'main',amount:100}); throw new Error('rollback');}));
  assert.equal((await lots(rollbackUser)).length,0);
  // 精准分页、筛选与版本失效。
  const page=await listReferrals({limit:1},inviter);
  assert.ok(page.pagination.hasNext);
  const next=await listReferrals({limit:1,position:'next',cursor:page.pagination.nextCursor,snapshotCursor:page.pagination.snapshotCursor},inviter);
  assert.equal(next.pagination.currentPage,2);
  await pay(rollbackOrder);
  await assert.rejects(listReferrals({limit:1,position:'next',cursor:page.pagination.nextCursor,snapshotCursor:page.pagination.snapshotCursor},inviter),e=>e.code==='PAGINATION_SNAPSHOT_CHANGED');
  assert.equal((await listReferrals({search:email})).pagination.totalItems,1);
  assert.equal((await listReferrals({status:'waiting'},tkInviter)).pagination.totalItems,0);
  await pool.query('UPDATE referral_settings SET enabled=$1,inviter_credits=$2,invitee_credits=$3',[savedSettings.enabled,savedSettings.inviter_credits,savedSettings.invitee_credits]);
  // 强制检查所有真实财务约束，不只检查表面余额。
  await pool.query('SELECT assert_user_credit_lot_balance(id) FROM users WHERE id=ANY($1::uuid[])',[userIds]);
  await pool.query('SELECT assert_credit_lot_allocations(id) FROM credit_lots WHERE user_id=ANY($1::uuid[])',[userIds]);
  console.log('REFERRAL_FULLSTACK_OK');
} finally { await app.close(); await pool.end(); }
