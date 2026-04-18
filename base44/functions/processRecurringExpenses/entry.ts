import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const recurringExpenses = await base44.asServiceRole.entities.Expense.filter({
      is_recurring: true
    });

    const today = new Date();
    const todayDate = today.toISOString().split('T')[0];

    for (const expense of recurringExpenses) {
      // Skip if recurrence period has ended
      if (expense.recurring_end_date && todayDate > expense.recurring_end_date) {
        continue;
      }

      // Only fire on the same day-of-month as the original payment
      const originalDate = new Date(expense.payment_date);
      if (today.getDate() !== originalDate.getDate()) {
        continue;
      }

      // Dedup by the source expense's own ID — prevents duplicates even if
      // the payee name changes or two expenses share the same payee.
      const sourceId = expense.recurring_source_id || expense.id;
      const existingToday = await base44.asServiceRole.entities.Expense.filter({
        shop_owner: expense.shop_owner,
        recurring_source_id: sourceId,
        payment_date: todayDate,
      });

      if (existingToday.length === 0) {
        const { id: _id, recurring_source_id: _src, ...rest } = expense;
        await base44.asServiceRole.entities.Expense.create({
          ...rest,
          payment_date: todayDate,
          recurring_source_id: sourceId,
          // New occurrences are not themselves recurring templates
          is_recurring: false,
        });
      }
    }

    return Response.json({ success: true, processed: recurringExpenses.length });
  } catch (error) {
    console.error('Error processing recurring expenses:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
