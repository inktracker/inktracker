import { describe, it, expect } from "vitest";
import {
  validateTaskTitle, validateDueDate, validateAssignee,
  buildAssignmentNotification, buildCompletionNotification,
} from "../teamTasks";

const ROSTER = [
  { email: "joe@biotamfg.co", name: "Joe Grennan" },
  { email: "sam@biotamfg.co", name: "Sam Rivera" },
];

describe("validateTaskTitle / validateDueDate", () => {
  it("trims and enforces bounds", () => {
    expect(validateTaskTitle("  Burn screens for CA89 ")).toEqual({ ok: true, title: "Burn screens for CA89" });
    expect(validateTaskTitle("").ok).toBe(false);
    expect(validateTaskTitle("x".repeat(301)).ok).toBe(false);
  });

  it("accepts empty due date, enforces YYYY-MM-DD otherwise", () => {
    expect(validateDueDate(null)).toEqual({ ok: true, dueDate: null });
    expect(validateDueDate("2026-09-03")).toEqual({ ok: true, dueDate: "2026-09-03" });
    expect(validateDueDate("9/3/2026").ok).toBe(false);
    expect(validateDueDate("2026-09-03T10:00:00Z").ok).toBe(false);
  });
});

describe("validateAssignee", () => {
  it("resolves roster members case-insensitively to canonical entries", () => {
    expect(validateAssignee("SAM@Biotamfg.co", ROSTER)).toEqual({
      ok: true, assignee: { email: "sam@biotamfg.co", name: "Sam Rivera" },
    });
  });

  it("allows unassigned, rejects strangers", () => {
    expect(validateAssignee("", ROSTER)).toEqual({ ok: true, assignee: null });
    expect(validateAssignee("intruder@x.co", ROSTER).ok).toBe(false);
  });
});

describe("buildAssignmentNotification", () => {
  const task = {
    id: "t1", title: "Burn screens", order_id: "ORD-2026-USKJZ",
    assignee_email: "sam@biotamfg.co", due_date: "2026-09-03",
    created_by: "joe@biotamfg.co", created_by_name: "Joe Grennan",
  };

  it("addresses the assignee with order deep-link and due date", () => {
    const n = buildAssignmentNotification({ shopOwner: "joe@biotamfg.co", task, actorEmail: "joe@biotamfg.co", orderRowId: "row-1" });
    expect(n).toMatchObject({
      recipient_email: "sam@biotamfg.co",
      event_type: "task_assigned",
      title: "Joe Grennan assigned you a task on ORD-2026-USKJZ",
      body: "Burn screens — due 2026-09-03",
      related_entity: "order",
      related_id: "row-1",
    });
  });

  it("is silent for self-assignment and for unassigned tasks", () => {
    expect(buildAssignmentNotification({ shopOwner: "s", task: { ...task, assignee_email: "joe@biotamfg.co" }, actorEmail: "joe@biotamfg.co" })).toBe(null);
    expect(buildAssignmentNotification({ shopOwner: "s", task: { ...task, assignee_email: null }, actorEmail: "joe@biotamfg.co" })).toBe(null);
  });

  it("shop-level task (no order) carries no dead deep-link", () => {
    const n = buildAssignmentNotification({ shopOwner: "s", task: { ...task, order_id: null }, actorEmail: "joe@biotamfg.co" });
    expect(n.related_entity).toBe(null);
    expect(n.title).toBe("Joe Grennan assigned you a task");
  });
});

describe("buildCompletionNotification", () => {
  const task = { id: "t1", title: "Burn screens", order_id: "ORD-1", created_by: "joe@biotamfg.co" };

  it("tells the creator when someone else completes", () => {
    const n = buildCompletionNotification({ shopOwner: "s", task, actorEmail: "sam@biotamfg.co", actorName: "Sam Rivera" });
    expect(n).toMatchObject({ recipient_email: "joe@biotamfg.co", event_type: "task_completed", title: "Sam Rivera completed a task on ORD-1" });
  });

  it("is silent when the creator completes their own task", () => {
    expect(buildCompletionNotification({ shopOwner: "s", task, actorEmail: "Joe@biotamfg.co", actorName: "Joe" })).toBe(null);
  });
});
