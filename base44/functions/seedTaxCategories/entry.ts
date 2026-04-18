import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const defaultCategories = [
      { name: "Cost of Goods", description: "Inventory and product costs", tax_code: "1000" },
      { name: "Printing", description: "Printing services and supplies", tax_code: "2000" },
      { name: "Supplies", description: "Office and operational supplies", tax_code: "3000" },
      { name: "Shipping", description: "Shipping and delivery costs", tax_code: "4000" },
      { name: "Software", description: "Software licenses and subscriptions", tax_code: "5000" },
      { name: "Travel", description: "Travel and business expenses", tax_code: "6000" },
      { name: "Utilities", description: "Electric, water, and other utilities", tax_code: "7000" },
      { name: "Equipment", description: "Equipment and machinery", tax_code: "8000" },
      { name: "Advertising", description: "Advertising and marketing", tax_code: "9000" },
      { name: "Insurance", description: "Business insurance", tax_code: "10000" },
    ];

    const existing = await base44.entities.TaxCategory.filter({ shop_owner: user.email });
    
    if (existing.length > 0) {
      return Response.json({ message: "Tax categories already exist", count: existing.length });
    }

    for (const cat of defaultCategories) {
      await base44.entities.TaxCategory.create({
        shop_owner: user.email,
        ...cat,
      });
    }

    return Response.json({ message: "Tax categories created", count: defaultCategories.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});