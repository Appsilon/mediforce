'use client';

import { useState } from 'react';
import { Plus, Shield, ToggleLeft, ToggleRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { validationRules as initialRules } from '@/lib/demo-data';
import type { ValidationRule, RuleType } from '@/lib/types';
import { cn } from '@/lib/utils';

function RuleTypeBadge({ type }: { type: RuleType }) {
  const variants: Record<RuleType, string> = {
    required: 'bg-blue-100 text-blue-800',
    format: 'bg-purple-100 text-purple-800',
    range: 'bg-orange-100 text-orange-800',
    completeness: 'bg-cyan-100 text-cyan-800',
    uniqueness: 'bg-pink-100 text-pink-800',
    terminology: 'bg-green-100 text-green-800',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        variants[type]
      )}
    >
      {type}
    </span>
  );
}

export default function ValidationRulesPage() {
  const [rules, setRules] = useState<ValidationRule[]>(initialRules);
  const [newRuleName, setNewRuleName] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);

  const enabledCount = rules.filter((r) => r.enabled).length;

  function toggleRule(ruleId: string) {
    setRules((prev) =>
      prev.map((rule) =>
        rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule
      )
    );
  }

  function addNewRule() {
    if (newRuleName.trim() === '') return;
    const newRule: ValidationRule = {
      id: `CUSTOM.${newRuleName.trim().toUpperCase().replace(/\s+/g, '_')}`,
      name: newRuleName.trim(),
      description: 'Custom validation rule — add description to define the check criteria.',
      domain: 'ALL',
      type: 'required',
      enabled: true,
    };
    setRules((prev) => [...prev, newRule]);
    setNewRuleName('');
    setShowAddForm(false);
  }

  const groupedRules: Record<string, ValidationRule[]> = {};
  rules.forEach((rule) => {
    const key = rule.domain;
    if (groupedRules[key] === undefined) {
      groupedRules[key] = [];
    }
    groupedRules[key].push(rule);
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header stats */}
      <div className="flex flex-wrap gap-4 items-center justify-between">
        <div className="flex gap-4">
          <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <div className="text-lg font-bold font-headline">{rules.length}</div>
              <div className="text-xs text-muted-foreground">Total rules</div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-green-500" />
            <div>
              <div className="text-lg font-bold font-headline text-green-600">{enabledCount}</div>
              <div className="text-xs text-muted-foreground">Active</div>
            </div>
          </div>
          <div className="rounded-lg border bg-card p-3 flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-muted-foreground" />
            <div>
              <div className="text-lg font-bold font-headline text-muted-foreground">
                {rules.length - enabledCount}
              </div>
              <div className="text-xs text-muted-foreground">Disabled</div>
            </div>
          </div>
        </div>

        <Button
          size="sm"
          className="gap-2"
          onClick={() => setShowAddForm((prev) => !prev)}
          variant={showAddForm ? 'secondary' : 'default'}
        >
          <Plus className="h-3.5 w-3.5" />
          Add Validation Rule
        </Button>
      </div>

      {/* Add rule form */}
      {showAddForm && (
        <div className="rounded-lg border bg-card p-4 space-y-3">
          <p className="text-sm font-medium">New Validation Rule</p>
          <div className="flex gap-2">
            <Input
              placeholder="Rule name (e.g. SDTM.DM.BRTHDTC)"
              value={newRuleName}
              onChange={(e) => setNewRuleName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addNewRule();
                if (e.key === 'Escape') setShowAddForm(false);
              }}
              autoFocus
            />
            <Button onClick={addNewRule} disabled={newRuleName.trim() === ''}>
              Add
            </Button>
            <Button variant="ghost" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Press Enter to add or Escape to cancel
          </p>
        </div>
      )}

      {/* Rules grouped by domain */}
      <div className="space-y-6">
        {Object.entries(groupedRules).map(([domain, domainRules]) => (
          <div key={domain}>
            <div className="flex items-center gap-3 mb-3">
              <h2 className="text-sm font-semibold text-foreground">
                Domain: <span className="font-mono">{domain}</span>
              </h2>
              <Badge variant="secondary" className="text-xs">
                {domainRules.length} rule{domainRules.length !== 1 ? 's' : ''}
              </Badge>
            </div>
            <div className="rounded-md border bg-card overflow-hidden">
              {domainRules.map((rule, index) => (
                <div key={rule.id}>
                  {index > 0 && <Separator />}
                  <div
                    className={cn(
                      'flex items-start gap-4 p-4 transition-colors',
                      !rule.enabled && 'opacity-50'
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium">{rule.name}</span>
                        <code className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {rule.id}
                        </code>
                        <RuleTypeBadge type={rule.type} />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {rule.description}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleRule(rule.id)}
                      className={cn(
                        'shrink-0 transition-colors',
                        rule.enabled ? 'text-primary' : 'text-muted-foreground'
                      )}
                      title={rule.enabled ? 'Disable rule' : 'Enable rule'}
                    >
                      {rule.enabled ? (
                        <ToggleRight className="h-6 w-6" />
                      ) : (
                        <ToggleLeft className="h-6 w-6" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
