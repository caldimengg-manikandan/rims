'use client'

import React, { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { APIClient } from '@/app/dashboard/lib/api-client'
import { toast } from "sonner"
import { Loader2, Save, Building2, User, Mail, Phone, FileText, ShieldAlert, Settings, Image as ImageIcon, Eye, UploadCloud, Palette } from 'lucide-react'
import { PageHeader } from '@/components/page-header'
import { useAuth } from '@/app/dashboard/lib/auth-context'
import { useRouter } from 'next/navigation'
import { ToggleTheme } from '@/components/lightswind/toggle-theme'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

export default function SettingsPage() {
    const { user } = useAuth()
    const router = useRouter()
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [settings, setSettings] = useState({
        company_logo_url: '',
        company_name: '',
        company_address: '',
        hr_email: '',
        hr_name: '',
        hr_phone: '',
        offer_letter_template: '',
        product_name: '',
        dark_logo_url: '',
        favicon_url: '',
        footer_text: '',
        support_email: '',
        theme_color: '',
        terms_url: '',
        privacy_url: '',
        seo_title_default: '',
        seo_description_default: ''
    })

    if (user && user.role !== 'super_admin') {
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-destructive opacity-20" />
                <h2 className="text-2xl font-black">Access Denied</h2>
                <p className="text-muted-foreground">This page is restricted to Super Administrators only.</p>
                <Button onClick={() => router.push('/dashboard/hr')}>Return to Dashboard</Button>
            </div>
        )
    }

    useEffect(() => {
        fetchSettings()
    }, [])

    const fetchSettings = async () => {
        setLoading(true)
        try {
            const data = await APIClient.get('/api/settings/sensitive') as any
            setSettings({
                company_logo_url: data.company_logo_url || '',
                company_name: data.company_name || '',
                company_address: data.company_address || '',
                hr_email: data.hr_email || '',
                hr_name: data.hr_name || '',
                hr_phone: data.hr_phone || '',
                offer_letter_template: data.offer_letter_template || '',
                product_name: data.product_name || '',
                dark_logo_url: data.dark_logo_url || '',
                favicon_url: data.favicon_url || '',
                footer_text: data.footer_text || '',
                support_email: data.support_email || '',
                theme_color: data.theme_color || '',
                terms_url: data.terms_url || '',
                privacy_url: data.privacy_url || '',
                seo_title_default: data.seo_title_default || '',
                seo_description_default: data.seo_description_default || ''
            })
        } catch (error) {
            toast.error("Failed to load settings")
        } finally {
            setLoading(false)
        }
    }
    const handleSave = async () => {
        if (!settings.company_name.trim() || !settings.hr_name.trim() || !settings.hr_email.trim() || !settings.hr_phone.trim() || !settings.company_address.trim()) {
            toast.error("Please fill in all required fields (Company Name, Address, HR Name, Email, Phone)");
            return;
        }

        const isEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(settings.hr_email);
        if (!isEmailValid) {
            toast.error("Please enter a valid email address");
            return;
        }

        const isPhoneValid = /^\+?[0-9\s]{7,15}$/.test(settings.hr_phone);
        if (!isPhoneValid) {
            toast.error("Please enter a valid phone number (7-15 digits)");
            return;
        }

        const isCompanyNameValid = /^[A-Za-z\s&.,'-]{2,100}$/.test(settings.company_name);
        if (!isCompanyNameValid) {
            toast.error("Please enter a valid company name");
            return;
        }

        const isNameValid = /^[A-Za-z\s'-]{2,50}$/.test(settings.hr_name);
        if (!isNameValid) {
            toast.error("Please enter a valid name");
            return;
        }

        if (settings.theme_color && !/^#[0-9A-Fa-f]{6}$/.test(settings.theme_color) && !/^#[0-9A-Fa-f]{3}$/.test(settings.theme_color)) {
            toast.error("Theme color must be a valid HEX color code (e.g. #2563eb)");
            return;
        }

        setSaving(true)
        try {
            const updated = await APIClient.post('/api/settings', settings) as any
            setSettings({
                company_logo_url: updated.company_logo_url || '',
                company_name: updated.company_name || '',
                company_address: updated.company_address || '',
                hr_email: updated.hr_email || '',
                hr_name: updated.hr_name || '',
                hr_phone: updated.hr_phone || '',
                offer_letter_template: updated.offer_letter_template || '',
                product_name: updated.product_name || '',
                dark_logo_url: updated.dark_logo_url || '',
                favicon_url: updated.favicon_url || '',
                footer_text: updated.footer_text || '',
                support_email: updated.support_email || '',
                theme_color: updated.theme_color || '',
                terms_url: updated.terms_url || '',
                privacy_url: updated.privacy_url || '',
                seo_title_default: updated.seo_title_default || '',
                seo_description_default: updated.seo_description_default || ''
            })
            toast.success("Saved successfully")
        } catch (error) {
            toast.error("Failed to update settings")
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-20 gap-4 min-h-[400px]">
                <div className="relative">
                    <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                    <div className="absolute inset-0 flex items-center justify-center">
                        <div className="h-6 w-6 rounded-full bg-primary/10 animate-pulse" />
                    </div>
                </div>
                <p className="text-xs font-bold text-muted-foreground uppercase tracking-widest animate-pulse">Loading System Settings...</p>
            </div>
        )
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <PageHeader
                title="System Settings"
                description="Configure company details and automation templates"
                icon={Settings}
            >
                <Button 
                    size="lg" 
                    className="font-bold gap-2 px-8 shadow-md rounded-xl h-12 active:scale-[0.98] hover:shadow-lg transition-all duration-200"
                    onClick={handleSave}
                    disabled={saving}
                >
                    {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                    Save Changes
                </Button>
            </PageHeader>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 stagger-children">
                <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden rounded-2xl pt-0 hover-premium-lift hover:shadow-md hover:border-border/60 transition-all duration-300">
                    <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pt-6">
                        <CardTitle className="flex items-center gap-2 text-base font-bold">
                            <div className="p-1.5 bg-primary/10 rounded-lg">
                                <Building2 className="h-4 w-4 text-primary" />
                            </div>
                            Company Profile
                        </CardTitle>
                        <CardDescription>Basic information used in communications</CardDescription>
                    </CardHeader>
                    <CardContent className="pb-6 space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="company_name">Company Name</Label>
                                <Input 
                                    id="company_name" 
                                    value={settings.company_name} 
                                    onChange={(e) => setSettings({...settings, company_name: e.target.value})}
                                    placeholder="Company name"
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>
                            
                            <div className="space-y-4">
                                <Label htmlFor="logo_url">Company Logo</Label>
                                <div className="flex items-center gap-4">
                                    <div className="h-20 w-20 rounded-2xl bg-muted/30 border-2 border-dashed border-border/50 flex items-center justify-center overflow-hidden group relative">
                                        {settings.company_logo_url ? (
                                            <img 
                                                src={settings.company_logo_url} 
                                                alt="Logo" 
                                                className="h-full w-full object-contain p-2"
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).src = 'https://api.dicebear.com/7.x/bottts/svg?seed=' + encodeURIComponent(settings.company_name || 'C')
                                                }}
                                            />
                                        ) : (
                                            <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
                                        )}
                                    </div>
                                    <div className="flex-1 space-y-2">
                                        <div className="flex gap-2 w-full">
                                            <Input 
                                                id="logo_url" 
                                                value={settings.company_logo_url} 
                                                onChange={(e) => setSettings({...settings, company_logo_url: e.target.value})}
                                                placeholder="https://example.com/logo.png"
                                                className="flex-1 h-12 hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                            />
                                        </div>
                                        <p className="text-[10px] text-muted-foreground italic">Paste a transparent PNG/SVG link for best results in PDFs.</p>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="company_address">Office Address</Label>
                                <Textarea 
                                    id="company_address" 
                                    value={settings.company_address} 
                                    onChange={(e) => setSettings({...settings, company_address: e.target.value})}
                                    placeholder="123 Silicon Valley, CA"
                                    rows={3}
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden flex flex-col rounded-2xl pt-0 hover-premium-lift hover:shadow-md hover:border-border/60 transition-all duration-300">
                    <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pt-6">
                        <CardTitle className="flex items-center gap-2 text-base font-bold">
                            <div className="p-1.5 bg-primary/10 rounded-lg">
                                <User className="h-4 w-4 text-primary" />
                            </div>
                            HR Details
                        </CardTitle>
                        <CardDescription>HR Contact Information</CardDescription>
                    </CardHeader>
                    
                    <CardContent className="p- space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="hr_name">HR Contact Name</Label>
                            <div className="relative">
                                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    id="hr_name" 
                                    className="pl-10 hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                    value={settings.hr_name} 
                                    onChange={(e) => setSettings({...settings, hr_name: e.target.value})}
                                    placeholder="e.g. Jane Smith"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hr_email">HR Contact Email</Label>
                            <div className="relative">
                                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    id="hr_email" 
                                    type="email"
                                    required
                                    className="pl-10 hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                    value={settings.hr_email} 
                                    onChange={(e) => setSettings({...settings, hr_email: e.target.value})}
                                    placeholder="hr@company.com"
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="hr_phone">HR Contact Phone</Label>
                            <div className="relative">
                                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input 
                                    id="hr_phone" 
                                    className="pl-10 hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                    value={settings.hr_phone} 
                                    maxLength={15}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === '' || /^[0-9+]+$/.test(val)) {
                                            setSettings({...settings, hr_phone: val});
                                        }
                                    }}
                                    placeholder="+91 9876543210"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* White-Label Branding Config Card */}
                <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden md:col-span-2 rounded-2xl pt-0 hover-premium-lift hover:shadow-md hover:border-border/60 transition-all duration-300">
                    <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pt-6">
                        <CardTitle className="flex items-center gap-2 text-base font-bold">
                            <div className="p-1.5 bg-primary/10 rounded-lg">
                                <Settings className="h-4 w-4 text-primary" />
                            </div>
                            White-Label Branding Config
                        </CardTitle>
                        <CardDescription>Customize the application's logo, colors, text, and policies for your brand identity</CardDescription>
                    </CardHeader>
                    <CardContent className="pb-6 space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="product_name">Product Name</Label>
                                <Input 
                                    id="product_name" 
                                    value={settings.product_name} 
                                    onChange={(e) => setSettings({...settings, product_name: e.target.value})}
                                    placeholder="e.g. CAL-RIMS"
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="theme_color">Primary Accent Color (HEX)</Label>
                                <div className="flex gap-2">
                                    <Input 
                                        id="theme_color" 
                                        value={settings.theme_color} 
                                        onChange={(e) => setSettings({...settings, theme_color: e.target.value})}
                                        placeholder="e.g. #2563eb"
                                        maxLength={7}
                                        className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                    />
                                    <div 
                                        className="w-12 h-10 rounded-lg border border-border shadow-inner flex-shrink-0" 
                                        style={{ backgroundColor: settings.theme_color || '#2563eb' }}
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="dark_logo_url">Dark Logo URL</Label>
                                <Input 
                                    id="dark_logo_url" 
                                    value={settings.dark_logo_url} 
                                    onChange={(e) => setSettings({...settings, dark_logo_url: e.target.value})}
                                    placeholder="e.g. /calrims/logo-dark.png"
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="favicon_url">Favicon URL</Label>
                                <Input 
                                    id="favicon_url" 
                                    value={settings.favicon_url} 
                                    onChange={(e) => setSettings({...settings, favicon_url: e.target.value})}
                                    placeholder="e.g. /calrims/logo.png"
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="support_email">Support Email</Label>
                                <Input 
                                    id="support_email" 
                                    value={settings.support_email} 
                                    onChange={(e) => setSettings({...settings, support_email: e.target.value})}
                                    placeholder="e.g. support@company.com"
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="terms_url">Terms of Service URL</Label>
                                <Input 
                                    id="terms_url" 
                                    value={settings.terms_url} 
                                    onChange={(e) => setSettings({...settings, terms_url: e.target.value})}
                                    placeholder="e.g. /calrims/terms/"
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="privacy_url">Privacy Policy URL</Label>
                                <Input 
                                    id="privacy_url" 
                                    value={settings.privacy_url} 
                                    onChange={(e) => setSettings({...settings, privacy_url: e.target.value})}
                                    placeholder="e.g. /calrims/privacy/"
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="seo_title_default">Default SEO Title</Label>
                                <Input 
                                    id="seo_title_default" 
                                    value={settings.seo_title_default} 
                                    onChange={(e) => setSettings({...settings, seo_title_default: e.target.value})}
                                    placeholder="e.g. MyBrand - Recruitment Portal"
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <Label htmlFor="footer_text">Footer Copyright/Branding Text</Label>
                                <Input 
                                    id="footer_text" 
                                    value={settings.footer_text} 
                                    onChange={(e) => setSettings({...settings, footer_text: e.target.value})}
                                    placeholder="e.g. Powered by Acme Corp. Built for teams who care about who they hire."
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>

                            <div className="space-y-2 md:col-span-2">
                                <Label htmlFor="seo_description_default">Default SEO Description</Label>
                                <Textarea 
                                    id="seo_description_default" 
                                    value={settings.seo_description_default} 
                                    onChange={(e) => setSettings({...settings, seo_description_default: e.target.value})}
                                    placeholder="Enter default SEO meta description..."
                                    rows={2}
                                    className="hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                                />
                            </div>
                        </div>
                    </CardContent>
                </Card>

            </div>

                <Card className="bg-card/45 backdrop-blur-xl border border-border/80 shadow-[0_8px_30px_rgb(0,0,0,0.02)] overflow-hidden rounded-2xl pt-0 hover-premium-lift hover:shadow-md hover:border-border/60 transition-all duration-300">
                    <CardHeader className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border-b border-border/40 pt-6">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle className="flex items-center gap-2 text-base font-bold">
                                    <div className="p-1.5 bg-primary/10 rounded-lg">
                                        <FileText className="h-4 w-4 text-primary" />
                                    </div>
                                    Offer Letter Template
                                </CardTitle>
                            <CardDescription>Paste the edited HTML code (with internal css) of the offer letter. Use the placeholders specified below</CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button 
                                variant="outline" 
                                size="sm" 
                                className="gap-2 active:scale-[0.98] transition-all duration-200"
                                onClick={() => {
                                    const input = document.createElement('input');
                                    input.type = 'file';
                                    input.accept = '.html';
                                    input.onchange = (e: any) => {
                                        const file = e.target.files[0];
                                        if (file) {
                                            // Validate file type
                                            const fileName = file.name.toLowerCase();
                                            if (!fileName.endsWith('.html') && !fileName.endsWith('.htm')) {
                                                toast.error("Invalid file type. Only HTML files are supported.");
                                                return;
                                            }

                                            const reader = new FileReader();
                                            reader.onload = (re) => {
                                                setSettings({...settings, offer_letter_template: re.target?.result as string});
                                                toast.success("Template uploaded successfully. Save changes before exiting");
                                            };
                                            reader.readAsText(file);
                                        }
                                    };
                                    input.click();
                                }}
                            >
                                <UploadCloud className="h-4 w-4" />
                                Upload HTML
                            </Button>
                            <Button 
                                variant="secondary" 
                                size="sm" 
                                className="gap-2 active:scale-[0.98] transition-all duration-200"
                                onClick={() => {
                                    if (!settings.offer_letter_template) {
                                        toast.error("Template is empty");
                                        return;
                                    }
                                    const win = window.open('', '_blank');
                                    if (win) {
                                        // Simple preview replacement for demonstration
                                        let html = settings.offer_letter_template;
                                        const logoUrl = settings.company_logo_url || '';
                                        const mocks: Record<string, string> = {
                                            candidate_name: 'John Doe',
                                            job_role: 'Software Engineer',
                                            department: 'Engineering',
                                            joining_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toLocaleDateString(),
                                            company_name: settings.company_name || 'Acme Corp',
                                            hr_name: settings.hr_name || 'HR Manager',
                                            hr_email: settings.hr_email || 'hr@company.com',
                                            hr_phone: settings.hr_phone || '+91 9876543210',
                                            company_address: settings.company_address || '123 Main St',
                                            offer_date: new Date().toLocaleDateString(),
                                            // Jinja2 style variables used by the backend template
                                            logo_url: logoUrl,
                                            logo: logoUrl,
                                            // Mustache-style fallback
                                            company_logo: logoUrl,
                                            company_logo_url: logoUrl,
                                        };
                                        // Replace both {{ var }} (Jinja2) and {{var}} (mustache) patterns
                                        Object.keys(mocks).forEach(key => {
                                            html = html.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), mocks[key]);
                                        });
                                        win.document.write(html);
                                        win.document.close();
                                    }
                                }}
                            >
                                <Eye className="h-4 w-4" />
                                Preview
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                 <CardContent className="pb-6 space-y-4">
                    <div className="bg-primary/5 border border-primary/15 p-4 rounded-xl">
                        <div className="flex items-center justify-between mb-2">
                            <h4 className="font-bold text-primary text-sm">Available Placeholders</h4>
                            <span className="text-[10px] uppercase font-bold text-muted-foreground/60">Usage: {'{{placeholder}}'}</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {['candidate_name', 'job_role', 'department', 'joining_date', 'company_name', 'hr_name', 'offer_date', 'hr_email', 'hr_phone', 'company_address', 'logo_url'].map(p => (
                                <code key={p} className="bg-background px-1.5 py-0.5 rounded border border-border text-[10px] font-mono shadow-sm text-foreground">{p}</code>
                            ))}
                        </div>
                    </div>
                    <div className="relative group">
                        <div className="absolute top-3 left-3 text-[10px] font-bold text-muted-foreground/30 uppercase pointer-events-none group-focus-within:opacity-50 transition-opacity">
                            HTML Source Code
                        </div>
                        <Textarea 
                            id="offer_letter_template" 
                            className="min-h-[250px] max-h-[500px] font-mono text-[11px] pt-8 leading-relaxed resize-y scrollbar-premium hover:border-primary/40 focus:border-primary focus:ring-4 focus:ring-primary/10 transition-all duration-200 rounded-xl"
                            value={settings.offer_letter_template} 
                            onChange={(e) => setSettings({...settings, offer_letter_template: e.target.value})}
                            placeholder="<html>\n  <head>\n    <style>...</style>\n  </head>\n  <body>\n    <h1>Welcome {{candidate_name}}!</h1>\n  </body>\n</html>"
                        />
                    </div>
                </CardContent>
            </Card>


        </div>
    )
}
