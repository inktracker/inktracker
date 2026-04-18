import { useEffect, useState } from "react";
import { base44 } from "@/api/supabaseClient";
import { useNavigate } from "react-router-dom";
import { createPageUrl } from "@/utils";

export default function RequireSetup({ children }) {
  const [isSetup, setIsSetup] = useState(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    async function checkSetup() {
      try {
        const user = await base44.auth.me();
        if (user && user.shop_name) {
          setIsSetup(true);
        } else {
          setIsSetup(false);
        }
      } catch (error) {
        setIsSetup(false);
      } finally {
        setLoading(false);
      }
    }
    checkSetup();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="text-slate-400">Loading...</div>
      </div>
    );
  }

  if (!isSetup) {
    navigate(createPageUrl("Setup"));
    return null;
  }

  return children;
}