import { PrismaClient } from '@prisma/client';
import 'dotenv/config';
import { hashPassword } from '../src/common/password';

const prisma = new PrismaClient();
const PASSWORD = 'Passw0rd!';
/** demo=写入完整演示数据；base=仅初始化管理员、分类、处理组、系统设置 */
const MODE = process.argv.includes('--base') ? 'base' : (process.env.SEED_MODE || 'demo').toLowerCase();
const withDemo = MODE !== 'base';

async function main() {
  const existing = await prisma.user.findFirst({ where: { email: 'admin@example.com' } });
  if (existing) {
    console.log('检测到已有数据，跳过种子数据（如需重置请删除 apps/api/prisma/dev.db 后重试）');
    return;
  }

  const admin = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      name: '系统管理员',
      role: 'ADMIN',
      status: 'ACTIVE',
      passwordHash: hashPassword(process.env.INITIAL_ADMIN_PASSWORD || 'Admin123!'),
      activatedAt: new Date(),
    },
  });

  const groupBase = await prisma.opsGroup.create({ data: { name: '基础运维组', description: '服务器、网络与账号问题' } });
  const groupApp = await prisma.opsGroup.create({ data: { name: '应用支持组', description: '业务系统与应用问题' } });

  const catServer = await prisma.category.create({
    data: { name: '服务器与网络', defaultGroupId: groupBase.id, sort: 1 },
  });
  const catApp = await prisma.category.create({
    data: { name: '业务系统', defaultGroupId: groupApp.id, sort: 2 },
  });
  const catAccount = await prisma.category.create({
    data: { name: '账号与权限', defaultGroupId: groupBase.id, sort: 3 },
  });

  await prisma.appSetting.createMany({
    data: [
      { key: 'siteName', value: '运维工单系统' },
      { key: 'reopenWindowDays', value: '7' },
      { key: 'maxAttachmentMb', value: '20' },
      { key: 'emailEnabled', value: 'true' },
    ],
  });

  if (!withDemo) {
    console.log('基础初始数据已生成（未写入演示数据）：');
    console.log('  管理员: admin@example.com / ' + (process.env.INITIAL_ADMIN_PASSWORD || 'Admin123!'));
    console.log(`  分类: ${catServer.name}、${catApp.name}、${catAccount.name}`);
    console.log(`  处理组: ${groupBase.name}、${groupApp.name}`);
    return;
  }

  const lead = await prisma.user.create({
    data: {
      email: 'lead@example.com',
      name: '周主管',
      role: 'OPS_LEAD',
      status: 'ACTIVE',
      passwordHash: hashPassword(PASSWORD),
      activatedAt: new Date(),
    },
  });
  const agent1 = await prisma.user.create({
    data: {
      email: 'agent1@example.com',
      name: '李工',
      role: 'AGENT',
      status: 'ACTIVE',
      passwordHash: hashPassword(PASSWORD),
      activatedAt: new Date(),
    },
  });
  const agent2 = await prisma.user.create({
    data: {
      email: 'agent2@example.com',
      name: '王工',
      role: 'AGENT',
      status: 'ACTIVE',
      passwordHash: hashPassword(PASSWORD),
      activatedAt: new Date(),
    },
  });
  await prisma.groupMember.createMany({
    data: [
      { groupId: groupBase.id, userId: lead.id, isLead: true },
      { groupId: groupBase.id, userId: agent1.id },
      { groupId: groupApp.id, userId: agent2.id },
    ],
  });

  const entA = await prisma.enterprise.create({
    data: { name: '华东制造有限公司', code: 'HD', contactName: '张经理', contactPhone: '13800000001' },
  });
  const entB = await prisma.enterprise.create({
    data: { name: '北辰科技有限公司', code: 'BC', contactName: '陈经理', contactPhone: '13800000002' },
  });

  const alice = await prisma.user.create({
    data: {
      email: 'alice@acme.com',
      name: '张敏',
      role: 'REPORTER',
      status: 'ACTIVE',
      enterpriseId: entA.id,
      passwordHash: hashPassword(PASSWORD),
      activatedAt: new Date(),
    },
  });
  const bob = await prisma.user.create({
    data: {
      email: 'bob@acme.com',
      name: '刘洋',
      role: 'REPORTER',
      status: 'ACTIVE',
      enterpriseId: entA.id,
      passwordHash: hashPassword(PASSWORD),
      activatedAt: new Date(),
    },
  });
  const carol = await prisma.user.create({
    data: {
      email: 'carol@beichen.com',
      name: '赵蕾',
      role: 'REPORTER',
      status: 'ACTIVE',
      enterpriseId: entB.id,
      passwordHash: hashPassword(PASSWORD),
      activatedAt: new Date(),
    },
  });
  await prisma.user.create({
    data: {
      email: 'david@beichen.com',
      name: '孙浩',
      role: 'REPORTER',
      status: 'INVITED',
      enterpriseId: entB.id,
      invitedAt: new Date(),
    },
  });

  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000);

  async function createTicket(input: {
    no: string;
    enterpriseId: string;
    reporterId: string;
    title: string;
    description: string;
    categoryId: string;
    groupId: string;
    priority: string;
    status: string;
    assigneeId?: string;
    createdHoursAgo: number;
    resolution?: string;
    closeReason?: string;
    closedHoursAgo?: number;
    cancelReason?: string;
  }) {
    const ticket = await prisma.ticket.create({
      data: {
        ticketNo: input.no,
        enterpriseId: input.enterpriseId,
        reporterId: input.reporterId,
        title: input.title,
        description: input.description,
        categoryId: input.categoryId,
        groupId: input.groupId,
        priority: input.priority,
        status: input.status,
        assigneeId: input.assigneeId ?? null,
        resolution: input.resolution ?? null,
        closeReason: input.closeReason ?? null,
        resolvedAt: input.resolution ? hoursAgo(input.createdHoursAgo - 2) : null,
        closedAt: input.closedHoursAgo ? hoursAgo(input.closedHoursAgo) : null,
        cancelledAt: input.status === 'CANCELLED' ? hoursAgo(input.createdHoursAgo - 1) : null,
        cancelReason: input.cancelReason ?? null,
        createdAt: hoursAgo(input.createdHoursAgo),
        lastActivityAt: hoursAgo(Math.max(0, input.createdHoursAgo - 3)),
      },
    });
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        actorId: input.reporterId,
        actorName: '提报人',
        action: 'CREATE',
        toValue: 'PENDING',
        visibility: 'PUBLIC',
        createdAt: hoursAgo(input.createdHoursAgo),
      },
    });
    if (input.assigneeId) {
      await prisma.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          actorId: input.assigneeId,
          actorName: '处理人',
          action: 'CLAIM',
          fromValue: 'PENDING',
          toValue: 'PROCESSING',
          visibility: 'PUBLIC',
          createdAt: hoursAgo(input.createdHoursAgo - 1),
        },
      });
    }
    return ticket;
  }

  const t1 = await createTicket({
    no: 'TK-20261120-0001',
    enterpriseId: entA.id,
    reporterId: alice.id,
    title: '生产数据库连接超时，业务出现间歇性报错',
    description: '从今天 9 点开始，ERP 系统偶发数据库连接超时，约每 10 分钟出现一次，影响订单录入。已重启应用无效。',
    categoryId: catServer.id,
    groupId: groupBase.id,
    priority: 'P1',
    status: 'PROCESSING',
    assigneeId: agent1.id,
    createdHoursAgo: 30,
  });
  await prisma.ticketComment.createMany({
    data: [
      {
        ticketId: t1.id,
        authorId: agent1.id,
        authorName: '李工',
        authorRole: 'AGENT',
        visibility: 'PUBLIC',
        content: '已收到，正在检查数据库连接池与慢查询日志。',
        createdAt: hoursAgo(28),
      },
      {
        ticketId: t1.id,
        authorId: agent1.id,
        authorName: '李工',
        authorRole: 'AGENT',
        visibility: 'INTERNAL',
        content: '连接池上限 50 已打满，怀疑应用存在连接泄漏，先临时调到 100。',
        createdAt: hoursAgo(27),
      },
    ],
  });

  await createTicket({
    no: 'TK-20261121-0001',
    enterpriseId: entA.id,
    reporterId: bob.id,
    title: 'VPN 账号无法登录，提示密码错误',
    description: '今天上午开始 VPN 无法登录，确认密码正确，同事可以正常登录，请协助处理。',
    categoryId: catAccount.id,
    groupId: groupBase.id,
    priority: 'P2',
    status: 'PENDING',
    createdHoursAgo: 20,
  });

  const t3 = await createTicket({
    no: 'TK-20261122-0001',
    enterpriseId: entB.id,
    reporterId: carol.id,
    title: 'CRM 系统报表导出为空白文件',
    description: '客户列表导出 Excel 后打开是空白，Chrome 和 Edge 都一样，昨天还正常。',
    categoryId: catApp.id,
    groupId: groupApp.id,
    priority: 'P2',
    status: 'PENDING_CONFIRM',
    assigneeId: agent2.id,
    createdHoursAgo: 50,
    resolution: '已修复导出模板中的字段映射问题，请重新导出验证；如仍有问题请回复本工单。',
  });
  await prisma.ticketComment.create({
    data: {
      ticketId: t3.id,
      authorId: agent2.id,
      authorName: '王工',
      authorRole: 'AGENT',
      visibility: 'PUBLIC',
      content: '问题已定位并修复，麻烦您再试一次导出。',
      createdAt: hoursAgo(45),
    },
  });

  await createTicket({
    no: 'TK-20261118-0001',
    enterpriseId: entA.id,
    reporterId: alice.id,
    title: '财务服务器磁盘空间不足告警',
    description: '监控显示财务服务器 /data 分区使用率 92%，请协助清理或扩容。',
    categoryId: catServer.id,
    groupId: groupBase.id,
    priority: 'P2',
    status: 'CLOSED',
    assigneeId: agent1.id,
    createdHoursAgo: 140,
    resolution: '已清理历史备份文件并调整日志轮转策略，当前使用率 61%。',
    closedHoursAgo: 100,
  });

  await createTicket({
    no: 'TK-20261123-0001',
    enterpriseId: entB.id,
    reporterId: carol.id,
    title: '新员工邮箱账号开通申请',
    description: '需要为新入职的 3 位同事开通企业邮箱，名单已发邮件给对接人。',
    categoryId: catAccount.id,
    groupId: groupBase.id,
    priority: 'P4',
    status: 'CLOSED',
    assigneeId: agent1.id,
    createdHoursAgo: 60,
    resolution: '3 个邮箱账号已开通并完成初始密码交付。',
    closedHoursAgo: 40,
  });

  await createTicket({
    no: 'TK-20261124-0001',
    enterpriseId: entA.id,
    reporterId: bob.id,
    title: '打印机无法连接网络',
    description: '二楼打印机突然离线，重启打印机无效，同事都无法打印。',
    categoryId: catServer.id,
    groupId: groupBase.id,
    priority: 'P3',
    status: 'CANCELLED',
    createdHoursAgo: 10,
    cancelReason: '打印机已自行恢复，先撤回工单。',
  });

  await prisma.notification.createMany({
    data: [
      {
        userId: agent1.id,
        type: 'TICKET_CREATED',
        title: `新工单 TK-20261120-0001`,
        body: '张敏 提交了工单「生产数据库连接超时，业务出现间歇性报错」',
        ticketId: t1.id,
      },
      {
        userId: alice.id,
        type: 'TICKET_COMMENT',
        title: `工单有新回复 TK-20261120-0001`,
        body: '李工：已收到，正在检查数据库连接池与慢查询日志。',
        ticketId: t1.id,
      },
    ],
  });

  await prisma.auditLog.create({
    data: {
      actorId: admin.id,
      action: 'ENTERPRISE_CREATE',
      targetType: 'Enterprise',
      targetId: entA.id,
      detail: JSON.stringify({ name: entA.name }),
    },
  });

  console.log('种子数据已生成（含演示数据）：');
  console.log('  管理员: admin@example.com / Admin123!');
  console.log('  运维主管: lead@example.com / Passw0rd!');
  console.log('  处理人: agent1@example.com / agent2@example.com / Passw0rd!');
  console.log('  客户员工: alice@acme.com / bob@acme.com / carol@beichen.com / Passw0rd!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
