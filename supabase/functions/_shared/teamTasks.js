// Pure logic for the teamTasks edge function — input validation and the
// notification rows a task change emits. Contract-tested in
// __tests__/teamTasks.test.js.

const norm = (v) => String(v ?? "").trim().toLowerCase();

/** Title: required, trimmed, hard cap matching the DB check. */
export function validateTaskTitle(title) {
  const t = String(title ?? "").trim();
  if (!t) return { ok: false, error: "Task needs a title" };
  if (t.length > 300) return { ok: false, error: "Title too long (300 characters max)" };
  return { ok: true, title: t };
}

/** Due date: optional; when present must be a plain YYYY-MM-DD. */
export function validateDueDate(dueDate) {
  if (dueDate === undefined || dueDate === null || dueDate === "") return { ok: true, dueDate: null };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dueDate))) {
    return { ok: false, error: "Due date must be YYYY-MM-DD" };
  }
  return { ok: true, dueDate: String(dueDate) };
}

/**
 * Assignee: optional; when present must be a shop roster member.
 * Returns the canonical roster entry so the stored name matches.
 */
export function validateAssignee(assigneeEmail, roster) {
  const e = norm(assigneeEmail);
  if (!e) return { ok: true, assignee: null };
  const hit = (roster ?? []).find((m) => norm(m.email) === e);
  if (!hit) return { ok: false, error: "Assignee is not a member of this shop" };
  return { ok: true, assignee: { email: norm(hit.email), name: hit.name || hit.email } };
}

/**
 * Notification for an assignment. Never pings the actor about their own
 * action (self-assignment is normal and silent — same rule as comments).
 */
export function buildAssignmentNotification({ shopOwner, task, actorEmail, orderRowId }) {
  const assignee = norm(task?.assignee_email);
  if (!assignee || assignee === norm(actorEmail)) return null;
  const due = task?.due_date ? ` — due ${task.due_date}` : "";
  const where = task?.order_id ? ` on ${task.order_id}` : "";
  return {
    shop_owner: shopOwner,
    recipient_email: assignee,
    event_type: "task_assigned",
    severity: "info",
    title: `${task?.created_by_name || actorEmail} assigned you a task${where}`,
    body: `${task?.title ?? ""}${due}`.trim(),
    related_entity: task?.order_id && orderRowId ? "order" : null,
    related_id: task?.order_id && orderRowId ? orderRowId : null,
    metadata: { task_id: task?.id ?? null, order_id: task?.order_id ?? null },
  };
}

/**
 * Notification when a task is completed: tell the person who created it,
 * unless they completed it themselves or created it for themselves.
 */
export function buildCompletionNotification({ shopOwner, task, actorEmail, actorName, orderRowId }) {
  const creator = norm(task?.created_by);
  if (!creator || creator === norm(actorEmail)) return null;
  const where = task?.order_id ? ` on ${task.order_id}` : "";
  return {
    shop_owner: shopOwner,
    recipient_email: creator,
    event_type: "task_completed",
    severity: "info",
    title: `${actorName || actorEmail} completed a task${where}`,
    body: String(task?.title ?? ""),
    related_entity: task?.order_id && orderRowId ? "order" : null,
    related_id: task?.order_id && orderRowId ? orderRowId : null,
    metadata: { task_id: task?.id ?? null, order_id: task?.order_id ?? null },
  };
}
