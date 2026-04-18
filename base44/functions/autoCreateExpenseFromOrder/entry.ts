import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { order_id, order_number, shop_owner, quote_id } = body;

    if (!order_id || !shop_owner) {
      return Response.json({ error: 'Missing order_id or shop_owner' }, { status: 400 });
    }

    // Fetch the order to get total and date
    const order = await base44.asServiceRole.entities.Order.list({
      query: { id: order_id }
    });

    if (!order || order.length === 0) {
      return Response.json({ error: 'Order not found' }, { status: 404 });
    }

    const orderData = order[0];

    // Check if an expense already exists for this order with auto_generation_type = order_conversion
    const existingExpenses = await base44.asServiceRole.entities.Expense.list({
      query: {
        linked_order_id: order_id,
        auto_generation_type: 'order_conversion',
        shop_owner: shop_owner
      }
    });

    if (existingExpenses && existingExpenses.length > 0) {
      return Response.json({ 
        success: false, 
        message: 'Expense for this order conversion already exists' 
      });
    }

    // Create the auto-generated expense
    const expenseId = `EXP-${Date.now()}`;
    const expenseData = {
      shop_owner: shop_owner,
      expense_id: expenseId,
      amount: orderData.total || 0,
      vendor: 'Order Conversion',
      category: 'Cost of Goods',
      date: new Date(orderData.date || orderData.created_date).toISOString().split('T')[0],
      notes: 'Auto-generated from quote conversion',
      status: 'Pending',
      source: 'Auto-generated from order conversion',
      linked_order_id: order_id,
      linked_order_number: order_number || orderData.order_id || '',
      originating_quote_id: quote_id || '',
      is_auto_generated: true,
      auto_generation_type: 'order_conversion',
      created_from_quote_conversion: true,
    };

    const createdExpense = await base44.asServiceRole.entities.Expense.create(expenseData);

    return Response.json({ 
      success: true, 
      expense_id: createdExpense.id,
      message: 'Expense auto-generated successfully' 
    });
  } catch (error) {
    console.error('Error creating expense:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});