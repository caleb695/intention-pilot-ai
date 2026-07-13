CREATE TABLE IF NOT EXISTS public.op_session_endpoint (
  id int PRIMARY KEY DEFAULT 1,
  url text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  run_id text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (id = 1)
);
GRANT SELECT ON public.op_session_endpoint TO anon, authenticated;
GRANT ALL ON public.op_session_endpoint TO service_role;
ALTER TABLE public.op_session_endpoint ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read endpoint" ON public.op_session_endpoint FOR SELECT USING (true);
DROP TRIGGER IF EXISTS op_session_endpoint_touch ON public.op_session_endpoint;
CREATE TRIGGER op_session_endpoint_touch BEFORE UPDATE ON public.op_session_endpoint
  FOR EACH ROW EXECUTE FUNCTION public.op_touch_updated_at();
INSERT INTO public.op_session_endpoint (id, url) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;