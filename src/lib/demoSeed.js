// Seeds a brand-new shop with sample customers, quotes, and orders so the app
// isn't empty when someone first signs up. Distinctive names ("Demo —" prefix)
// make these easy to spot and delete later.
//
// Idempotent: bails out if the shop already has any customers, quotes, or
// orders. Safe to call multiple times.

import { base44 } from "@/api/supabaseClient";

const DEMO_PREFIX = "Demo — ";

const today = () => {
  const d = new Date();
  return d.toISOString().slice(0, 10);
};

const daysFromNow = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

const newId = (prefix) =>
  `${prefix}-${new Date().getFullYear()}-DEMO${Math.floor(Math.random() * 9000 + 1000)}`;

const lineItem = (overrides = {}) => ({
  id: crypto.randomUUID?.() ?? String(Math.random()).slice(2),
  garment_brand: "AS Colour",
  garment_style: "Staple Tee",
  garment_color: "Natural",
  quantity: 50,
  print_locations: 1,
  colors_per_location: 2,
  base_price: 6.5,
  print_price: 4.0,
  unit_price: 10.5,
  ...overrides,
});

export async function seedDemoData(userEmail) {
  if (!userEmail) return { skipped: "no email" };

  // Idempotency check — if anything's already there, do nothing.
  try {
    const [existingCustomers, existingQuotes, existingOrders] = await Promise.all([
      base44.entities.Customer.filter({ shop_owner: userEmail }, null, 1),
      base44.entities.Quote.filter({ shop_owner: userEmail }, null, 1),
      base44.entities.Order.filter({ shop_owner: userEmail }, null, 1),
    ]);
    if (existingCustomers.length || existingQuotes.length || existingOrders.length) {
      return { skipped: "shop already has data" };
    }
  } catch (err) {
    console.warn("[demoSeed] could not check existing data; aborting:", err);
    return { error: err.message };
  }

  const customers = [
    {
      name: `${DEMO_PREFIX}Reno Running Co`,
      email: "events@reno-running-demo.test",
      phone: "(775) 555-0101",
      address: "100 Liberty St, Reno, NV 89501",
      shop_owner: userEmail,
      orders: 1,
    },
    {
      name: `${DEMO_PREFIX}Midtown Brewery`,
      email: "merch@midtown-brewery-demo.test",
      phone: "(775) 555-0144",
      address: "750 S Virginia St, Reno, NV 89501",
      shop_owner: userEmail,
      orders: 0,
    },
    {
      name: `${DEMO_PREFIX}Truckee High Boosters`,
      email: "boosters@truckee-high-demo.test",
      phone: "(530) 555-0188",
      address: "11725 Donner Pass Rd, Truckee, CA 96161",
      shop_owner: userEmail,
      orders: 0,
    },
  ];

  let createdCustomers = [];
  try {
    createdCustomers = await Promise.all(
      customers.map((c) => base44.entities.Customer.create(c))
    );
  } catch (err) {
    console.warn("[demoSeed] customer create failed:", err);
    return { error: err.message };
  }

  const [renoRunning, midtown, truckee] = createdCustomers;

  const quotes = [
    {
      quote_id: newId("Q"),
      shop_owner: userEmail,
      customer_id: renoRunning.id,
      customer_name: renoRunning.name,
      customer_email: renoRunning.email,
      job_title: "5K Event Tees — June",
      status: "Sent",
      date: today(),
      due_date: daysFromNow(14),
      line_items: [
        lineItem({ garment_color: "Asphalt", quantity: 120, colors_per_location: 1, base_price: 6.5, print_price: 2.5, unit_price: 9.0 }),
      ],
      notes: "Demo quote — feel free to edit or delete.",
    },
    {
      quote_id: newId("Q"),
      shop_owner: userEmail,
      customer_id: midtown.id,
      customer_name: midtown.name,
      customer_email: midtown.email,
      job_title: "Stout Label Crewnecks",
      status: "Draft",
      date: today(),
      due_date: daysFromNow(21),
      line_items: [
        lineItem({ garment_style: "Stencil Crewneck", garment_color: "Black", quantity: 40, colors_per_location: 3, base_price: 22.0, print_price: 5.5, unit_price: 27.5 }),
      ],
      notes: "Demo quote — feel free to edit or delete.",
    },
    {
      quote_id: newId("Q"),
      shop_owner: userEmail,
      customer_id: truckee.id,
      customer_name: truckee.name,
      customer_email: truckee.email,
      job_title: "Booster Hoodies",
      status: "Approved",
      date: today(),
      due_date: daysFromNow(10),
      line_items: [
        lineItem({ garment_style: "Stencil Hood", garment_color: "Forest", quantity: 75, colors_per_location: 2, base_price: 28.0, print_price: 5.0, unit_price: 33.0 }),
      ],
      notes: "Demo quote — feel free to edit or delete.",
    },
    {
      quote_id: newId("Q"),
      shop_owner: userEmail,
      customer_id: midtown.id,
      customer_name: midtown.name,
      customer_email: midtown.email,
      job_title: "Brewery Staff Shirts",
      status: "Sent",
      date: today(),
      due_date: daysFromNow(7),
      line_items: [
        lineItem({ quantity: 12, colors_per_location: 1, base_price: 6.5, print_price: 3.5, unit_price: 10.0 }),
      ],
      notes: "Demo quote — feel free to edit or delete.",
    },
    {
      quote_id: newId("Q"),
      shop_owner: userEmail,
      customer_id: renoRunning.id,
      customer_name: renoRunning.name,
      customer_email: renoRunning.email,
      job_title: "Volunteer Shirts",
      status: "Expired",
      date: today(),
      due_date: daysFromNow(-3),
      line_items: [lineItem({ quantity: 20, colors_per_location: 1, base_price: 6.5, print_price: 2.5, unit_price: 9.0 })],
      notes: "Demo quote — feel free to edit or delete.",
    },
  ];

  try {
    await Promise.all(quotes.map((q) => base44.entities.Quote.create(q)));
  } catch (err) {
    console.warn("[demoSeed] quote create failed:", err);
  }

  const orders = [
    {
      order_id: newId("ORD"),
      shop_owner: userEmail,
      customer_id: renoRunning.id,
      customer_name: renoRunning.name,
      job_title: "Spring 5K Tees",
      date: today(),
      due_date: daysFromNow(5),
      status: "Art Approval",
      line_items: [
        lineItem({ garment_color: "Heather", quantity: 90, colors_per_location: 2, base_price: 6.5, print_price: 4.0, unit_price: 10.5 }),
      ],
      notes: "Demo order — feel free to edit or delete.",
    },
    {
      order_id: newId("ORD"),
      shop_owner: userEmail,
      customer_id: truckee.id,
      customer_name: truckee.name,
      job_title: "Team Warmups",
      date: today(),
      due_date: daysFromNow(12),
      status: "On Press",
      line_items: [
        lineItem({ garment_style: "Stencil Hood", garment_color: "Forest", quantity: 60, colors_per_location: 3, base_price: 28.0, print_price: 5.5, unit_price: 33.5 }),
      ],
      notes: "Demo order — feel free to edit or delete.",
    },
  ];

  try {
    await Promise.all(orders.map((o) => base44.entities.Order.create(o)));
  } catch (err) {
    console.warn("[demoSeed] order create failed:", err);
  }

  return { ok: true, customers: createdCustomers.length, quotes: quotes.length, orders: orders.length };
}
