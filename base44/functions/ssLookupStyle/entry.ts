import { createClientFromRequest } from 'npm:@base44/sdk@0.8.23';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { styleNumber } = body;

    if (!styleNumber) {
      return Response.json({ error: 'Style number required' }, { status: 400 });
    }

    // Call sendQuoteEmail function with ss_lookup action
    const result = await base44.asServiceRole.functions.invoke('sendQuoteEmail', {
      action: 'ss_lookup',
      styleNumber: styleNumber,
    });

    return Response.json(result.data);
  } catch (error) {
    console.error('S&S lookup error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});