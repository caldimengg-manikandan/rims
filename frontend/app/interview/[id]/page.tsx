'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import dynamic from 'next/dynamic';

const InterviewSession = dynamic(
    () => import('@/modules/interview/InterviewSession'),
    { ssr: false }
);

export default function CandidateInterviewPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const [token, setToken] = useState('');

    const sessionId = (params.id as string) || 'test-session';

    useEffect(() => {
        const q = searchParams.get('token');
        const fromStorage = typeof window !== 'undefined' ? sessionStorage.getItem('interview_token') : null;
        setToken(q?.trim() || fromStorage?.trim() || '');
    }, [searchParams]);

    return (
        <div className="min-h-screen bg-gradient-to-tr from-primary/10 via-background to-accent/10 flex flex-col">
            <main className="flex-1 w-full max-w-7xl mx-auto p-6 md:p-12 overflow-hidden">
                {token ? (
                    <InterviewSession sessionId={sessionId} token={token} />
                ) : (
                    <p className="text-center text-muted-foreground mt-12">
                        Missing interview token. Open this page from your interview link, complete access on{' '}
                        <a href="/interview/access" className="text-primary underline">/interview/access</a>
                        , or add <code className="text-xs">?token=…</code> for testing.
                    </p>
                )}
            </main>
        </div>
    );
}
