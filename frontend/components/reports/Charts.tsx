'use client'

import React from 'react'
import { PieChart, Pie, BarChart, Bar, XAxis, YAxis, CartesianGrid, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Report {
    question_evaluations: any[]
    evaluated_skills?: string | null
}

export const StatusChart = React.memo(({ data }: { data: { name: string, value: number, color: string }[] }) => (
    <ResponsiveContainer width="100%" height={200} style={{ fontFamily: 'var(--font-sans)' }}>
        <PieChart>
            <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={60}
                outerRadius={80}
                paddingAngle={5}
                dataKey="value"
            >
                {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
            </Pie>
            <Tooltip />
            <Legend />
        </PieChart>
    </ResponsiveContainer>
))

export const DetailedMetricsChart = React.memo(({ report, showNoData }: { report: Report; showNoData?: boolean }) => {
    let sums = { technical: 0, completeness: 0, depth: 0 };
    let counts = { technical: 0, completeness: 0, depth: 0 };

    report?.question_evaluations?.forEach(q => {
        if (q?.evaluation) {
            if (q.evaluation.technical_accuracy !== undefined) {
                sums.technical += q.evaluation.technical_accuracy;
                counts.technical++;
            }
            if (q.evaluation.completeness !== undefined) {
                sums.completeness += q.evaluation.completeness;
                counts.completeness++;
            }
            if (q.evaluation.depth !== undefined) {
                sums.depth += q.evaluation.depth;
                counts.depth++;
            }
        }
    });

    const data = [];
    if (counts.technical > 0) data.push({ name: 'Technical', score: sums.technical / counts.technical });
    if (counts.completeness > 0) data.push({ name: 'Completeness', score: sums.completeness / counts.completeness });
    if (counts.depth > 0) data.push({ name: 'Depth', score: sums.depth / counts.depth });

    const allMetricZeros = data.length > 0 && data.every((d) => (d.score ?? 0) === 0);

    if (showNoData || allMetricZeros) {
        return (
            <div className="flex h-full min-h-[160px] items-center justify-center text-center text-sm text-muted-foreground px-4">
                No data available.
            </div>
        );
    }

    return (
        <ResponsiveContainer width="100%" height="100%" style={{ fontFamily: 'var(--font-sans)' }}>
            <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--border)" />
                <XAxis type="number" domain={[0, 10]} hide />
                <YAxis dataKey="name" type="category" tick={{ fill: 'currentColor', fontSize: 11, fontFamily: 'var(--font-sans)' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip
                    cursor={{ fill: 'var(--muted)' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontFamily: 'var(--font-sans)' }}
                    formatter={(value: number) => value.toFixed(1)}
                />
                <Bar dataKey="score" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(var(--primary))`} fillOpacity={0.4 + (index * 0.15)} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    )
})

export const SkillProficiencyChart = React.memo(({ report }: { report: Report }) => {
    let skillsData: { name: string, score: number }[] = [];

    try {
        if (report?.evaluated_skills) {
            const parsedSkills = JSON.parse(report.evaluated_skills);
            if (Array.isArray(parsedSkills)) {
                skillsData = parsedSkills.map((s: any) => ({
                    name: s?.skillName || 'Skill',
                    score: s?.score || 0
                }));
            }
        }
    } catch (e) {
        console.error("Failed to parse evaluated_skills", e);
    }

    const data = skillsData.length > 0 ? skillsData : [];

    return (
        <ResponsiveContainer width="100%" height="100%" style={{ fontFamily: 'var(--font-sans)' }}>
            <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--border)" />
                <XAxis type="number" domain={[0, 10]} hide />
                <YAxis dataKey="name" type="category" tick={{ fill: 'currentColor', fontSize: 11, fontFamily: 'var(--font-sans)' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip
                    cursor={{ fill: 'var(--muted)' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontFamily: 'var(--font-sans)' }}
                    formatter={(value: number) => value.toFixed(1)}
                />
                <Bar dataKey="score" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(var(--primary))`} fillOpacity={0.4 + (index * 0.15)} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    )
})

export const AllReportsMetricsChart = React.memo(({ reports }: { reports: any[] }) => {
    let sums = { technical: 0, completeness: 0, depth: 0 };
    let counts = { technical: 0, completeness: 0, depth: 0 };

    reports?.forEach(report => {
        report?.question_evaluations?.forEach((q: any) => {
            if (q?.evaluation) {
                if (q.evaluation.technical_accuracy !== undefined) {
                    sums.technical += q.evaluation.technical_accuracy;
                    counts.technical++;
                }
                if (q.evaluation.completeness !== undefined) {
                    sums.completeness += q.evaluation.completeness;
                    counts.completeness++;
                }
                if (q.evaluation.depth !== undefined) {
                    sums.depth += q.evaluation.depth;
                    counts.depth++;
                }
            }
        });
    });

    const data = [];
    if (counts.technical > 0) data.push({ name: 'Technical', score: sums.technical / counts.technical });
    if (counts.completeness > 0) data.push({ name: 'Completeness', score: sums.completeness / counts.completeness });
    if (counts.depth > 0) data.push({ name: 'Depth', score: sums.depth / counts.depth });

    return (
        <ResponsiveContainer width="100%" height="100%" style={{ fontFamily: 'var(--font-sans)' }}>
            <BarChart data={data} margin={{ top: 10, right: 10, left: 10, bottom: 0 }} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="var(--border)" />
                <XAxis type="number" domain={[0, 10]} hide />
                <YAxis dataKey="name" type="category" tick={{ fill: 'currentColor', fontSize: 11, fontFamily: 'var(--font-sans)' }} axisLine={false} tickLine={false} width={80} />
                <Tooltip
                    cursor={{ fill: 'var(--muted)' }}
                    contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--background)', color: 'var(--foreground)', fontFamily: 'var(--font-sans)' }}
                    formatter={(value: number) => value.toFixed(1)}
                />
                <Bar dataKey="score" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(var(--primary))`} fillOpacity={0.4 + (index * 0.15)} />
                    ))}
                </Bar>
            </BarChart>
        </ResponsiveContainer>
    )
})

StatusChart.displayName = 'StatusChart'
DetailedMetricsChart.displayName = 'DetailedMetricsChart'
SkillProficiencyChart.displayName = 'SkillProficiencyChart'
AllReportsMetricsChart.displayName = 'AllReportsMetricsChart'
