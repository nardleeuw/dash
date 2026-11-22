// Unit tests never talk to real providers or send email.
process.env.APP_ENV = "test";
process.env.MOCK_PROVIDERS = process.env.MOCK_PROVIDERS_TEST ?? "kvk,google_places,osm,pdok,hunter,openai,pagespeed,stripe";
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.UNSUBSCRIBE_SECRET ??= "test-unsubscribe-secret";
