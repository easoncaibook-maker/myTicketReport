import { ROLE_LABELS, Role, STATUS_LABELS, PRIORITY_LABELS, TicketStatus, Priority } from '@ticketreport/shared';

export function ticketSummary(ticket: any) {
  return {
    id: ticket.id,
    ticketNo: ticket.ticketNo,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    statusLabel: STATUS_LABELS[ticket.status as TicketStatus] ?? ticket.status,
    priority: ticket.priority,
    priorityLabel: PRIORITY_LABELS[ticket.priority as Priority] ?? ticket.priority,
    enterpriseId: ticket.enterpriseId,
    enterpriseName: ticket.enterprise?.name,
    reporterId: ticket.reporterId,
    reporterName: ticket.reporter?.name,
    assigneeId: ticket.assigneeId,
    assigneeName: ticket.assignee?.name ?? null,
    groupId: ticket.groupId,
    groupName: ticket.group?.name,
    categoryId: ticket.categoryId,
    categoryName: ticket.category?.name,
    reopenCount: ticket.reopenCount,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    lastActivityAt: ticket.lastActivityAt,
    closedAt: ticket.closedAt,
    cancelledAt: ticket.cancelledAt,
  };
}

export function commentView(comment: any) {
  return {
    id: comment.id,
    authorId: comment.authorId,
    authorName: comment.authorName,
    authorRole: comment.authorRole,
    authorRoleLabel: ROLE_LABELS[comment.authorRole as Role] ?? comment.authorRole,
    visibility: comment.visibility,
    content: comment.content,
    createdAt: comment.createdAt,
    deletedAt: comment.deletedAt,
    attachments: (comment.attachments ?? []).map(attachmentView),
  };
}

export function attachmentView(attachment: any) {
  return {
    id: attachment.id,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    size: attachment.size,
    createdAt: attachment.createdAt,
    downloadUrl: `/api/attachments/${attachment.id}/download`,
  };
}

export function ticketDetail(ticket: any, viewerRole: Role) {
  const isCustomer = viewerRole === 'REPORTER';
  const comments = (ticket.comments ?? [])
    .filter((c: any) => !isCustomer || c.visibility === 'PUBLIC')
    .map(commentView);
  const events = (ticket.events ?? [])
    .filter((e: any) => !isCustomer || e.visibility === 'PUBLIC')
    .map((e: any) => ({
      id: e.id,
      actorId: e.actorId,
      actorName: e.actorName,
      action: e.action,
      fromValue: isCustomer ? null : e.fromValue,
      toValue: isCustomer ? null : e.toValue,
      reason: e.reason,
      visible: e.visibility,
      createdAt: e.createdAt,
    }));
  const attachments = (ticket.attachments ?? []).map(attachmentView);
  return {
    ...ticketSummary(ticket),
    resolution: ticket.resolution,
    resolvedAt: ticket.resolvedAt,
    confirmedAt: ticket.confirmedAt,
    closeReason: ticket.closeReason,
    cancelReason: ticket.cancelReason,
    comments,
    events,
    attachments,
    reporterEmail: isCustomer ? undefined : ticket.reporter?.email,
    assigneeEmail: isCustomer ? undefined : ticket.assignee?.email,
  };
}
