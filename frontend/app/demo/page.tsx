"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, Rocket, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { getApiBaseUrl } from "@/lib/config";

export default function DemoInterviewPage() {
  const [isLoading, setIsLoading] = useState(false);

  const handleLaunchDemo = async () => {
    setIsLoading(true);
    try {
      const apiUrl = getApiBaseUrl();
      const response = await fetch(`${apiUrl}/api/interviews/demo`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to generate demo session: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (data.demo_url) {
        if (data.access_token) {
          sessionStorage.setItem("interview_token", data.access_token);
          document.cookie = `interview_token=${data.access_token}; path=/; max-age=14400; SameSite=Strict`;
        }
        toast.success("Demo session generated! Redirecting...");
        // Redirect to the interview session
        window.location.href = data.demo_url;
      } else {
        throw new Error("Invalid response from server");
      }
    } catch (error) {
      console.error(error);
      toast.error("Failed to launch demo interview. Check console for details.");
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
      <Card className="max-w-md w-full bg-slate-900 border-slate-800 text-slate-100">
        <CardHeader className="text-center pb-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 flex items-center justify-center mx-auto mb-4 border border-primary/30">
            <Rocket className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-black">Private Demo Mode</CardTitle>
          <CardDescription className="text-slate-400">
            Internal testing utility
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="bg-amber-950/30 border border-amber-900/50 rounded-lg p-4 text-sm text-amber-200/80 flex gap-3">
            <ShieldAlert className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <p>
              This launches a live mock interview under job <code className="bg-black/50 px-1 py-0.5 rounded text-amber-400">JOB-05A5RV</code>.
              An application record is <strong>only saved</strong> if the interview is completed successfully.
              Ending the session early or being terminated by proctoring will leave <strong>no record</strong> in the pipeline.
            </p>
          </div>
          
          <Button 
            className="w-full h-14 text-lg font-bold" 
            onClick={handleLaunchDemo}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                Provisioning Session...
              </>
            ) : (
              "Launch Live Demo Interview"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
