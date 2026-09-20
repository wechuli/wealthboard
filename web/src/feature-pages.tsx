import { CandlestickChart } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import {
  getAI,
  getCategories,
  getEstate,
  getEstateSnapshot,
  getInstitutions,
  getInstrument,
  getInstruments,
} from "./api";
import { MoneyValue, PrivateValue } from "./privacy";
import type { EstateWorkspace, SecurityPrice } from "./types";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  formatDate,
  humanize,
  KeyValue,
  PageHeader,
  ResourceView,
} from "./ui";
import { useResource } from "./use-resource";
import { CategoryManager, InstitutionManager } from "./metadata-forms";
import type { Session } from "./types";
import { useState } from "react";
import { InstrumentForm, InstrumentManager } from "./planning-forms";

export function CategoriesPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(getCategories, [refresh]);
  return (
    <>
      <PageHeader
        eyebrow="Classification"
        title="Categories"
        description="Asset and liability classifications used across the portfolio."
      />
      <ResourceView state={state}>
        {({ items }) => (
          <CategoryManager
            categories={items}
            csrfToken={session.csrfToken}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        )}
      </ResourceView>
    </>
  );
}

export function InstitutionsPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(getInstitutions, [refresh]);
  return (
    <>
      <PageHeader
        eyebrow="Reference data"
        title="Institutions"
        description="Financial institutions associated with tracked accounts."
      />
      <ResourceView state={state}>
        {({ items }) => (
          <InstitutionManager
            institutions={items}
            csrfToken={session.csrfToken}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        )}
      </ResourceView>
    </>
  );
}

export function InstrumentsPage({ session }: { session: Session }) {
  const [refresh, setRefresh] = useState(0);
  const state = useResource(getInstruments, [refresh]);
  return (
    <>
      <PageHeader
        eyebrow="Investments"
        title="Instruments"
        description="Securities, identifiers, and latest recorded prices."
      />
      <ResourceView state={state}>
        {({ instruments }) => (
          <div className="settings-stack">
            <Card>
              <CardHeader title="Create instrument" />
              <InstrumentForm
                session={session}
                onChanged={() => setRefresh((value) => value + 1)}
              />
            </Card>
            {instruments.length ? (
              <div className="account-list">
                {instruments.map((item) => (
                  <Link
                    className="account-row"
                    to={`/instruments/${item.id}`}
                    key={item.id}
                  >
                    <div className="account-icon">
                      <CandlestickChart />
                    </div>
                    <div className="account-main">
                      <strong>{item.name}</strong>
                      <span>
                        {item.symbol ||
                          item.identifier ||
                          humanize(item.assetType)}
                      </span>
                    </div>
                    <div className="account-value">
                      <strong>
                        {item.latestPrice ? (
                          <PrivateValue>
                            {item.latestPrice.currency} {item.latestPrice.price}
                          </PrivateValue>
                        ) : (
                          "No price"
                        )}
                      </strong>
                      <span>
                        {item.latestPrice
                          ? formatDate(item.latestPrice.effectiveDate)
                          : item.quoteCurrency}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState
                title="No instruments"
                description="No investment instruments are configured."
              />
            )}
          </div>
        )}
      </ResourceView>
    </>
  );
}

export function InstrumentDetailPage({ session }: { session: Session }) {
  const { id = "" } = useParams();
  const [refresh, setRefresh] = useState(0);
  const state = useResource(() => getInstrument(id), [id, refresh]);
  return (
    <ResourceView state={state} loadingLabel="Loading instrument...">
      {({ instrument, prices }) => (
        <>
          <PageHeader
            eyebrow="Instrument"
            title={instrument.name}
            description={[
              instrument.symbol,
              humanize(instrument.assetType),
              instrument.exchangeMic,
            ]
              .filter(Boolean)
              .join(" · ")}
            actions={
              <Link className="secondary-button" to="/instruments">
                All instruments
              </Link>
            }
          />
          <div className="metric-grid">
            <TextMetric
              label="Quote currency"
              value={instrument.quoteCurrency}
            />
            <TextMetric
              label="Identifier"
              value={instrument.identifier || "Not set"}
            />
            <TextMetric
              label="Identifier type"
              value={humanize(instrument.identifierType)}
            />
            <TextMetric
              label="Status"
              value={instrument.archivedAt ? "Archived" : "Active"}
            />
          </div>
          <PriceHistory prices={prices} />
          <InstrumentManager
            instrument={instrument}
            prices={prices}
            session={session}
            onChanged={() => setRefresh((value) => value + 1)}
          />
        </>
      )}
    </ResourceView>
  );
}

function PriceHistory({ prices }: { prices: SecurityPrice[] }) {
  return (
    <Card className="section-block">
      <CardHeader
        title="Price history"
        description="Effective-dated prices, newest first"
      />
      {prices.length ? (
        <div className="data-list">
          {prices.map((price) => (
            <div className="data-row" key={price.id}>
              <div>
                <strong>{formatDate(price.effectiveDate)}</strong>
                <span>
                  {price.source}
                  {price.provenance ? ` · ${price.provenance}` : ""}
                </span>
              </div>
              <strong>
                <PrivateValue>
                  {price.currency} {price.price}
                </PrivateValue>
              </strong>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          title="No prices"
          description="This instrument has no recorded prices."
        />
      )}
    </Card>
  );
}

export function EstatePage() {
  const state = useResource(getEstate);
  return (
    <>
      <PageHeader
        eyebrow="Planning"
        title="Estate"
        description="Beneficiaries, account directives, allocations, and immutable snapshots."
      />
      <ResourceView state={state}>
        {(estate) => <EstateWorkspaceView estate={estate} />}
      </ResourceView>
    </>
  );
}

function EstateWorkspaceView({ estate }: { estate: EstateWorkspace }) {
  if (!estate.plan && !estate.beneficiaries.length && !estate.directives.length)
    return (
      <EmptyState
        title="No estate plan"
        description="Estate planning records will appear here when configured."
      />
    );
  const beneficiaryName = (id: string) =>
    estate.beneficiaries.find((item) => item.id === id)?.name ||
    "Unknown beneficiary";
  return (
    <>
      {!estate.currentValuesComplete ? (
        <div className="notice warning">{estate.currentValuesWarning}</div>
      ) : null}
      {estate.plan ? (
        <Card>
          <CardHeader
            title={estate.plan.title}
            description={estate.plan.jurisdiction || "Jurisdiction not set"}
          />
          <div className="key-grid">
            <KeyValue label="Last reviewed">
              {formatDate(estate.plan.lastReviewedDate)}
            </KeyValue>
            <KeyValue label="Review reminder">
              {formatDate(estate.plan.reviewReminderDate)}
            </KeyValue>
          </div>
        </Card>
      ) : null}
      <div className="detail-grid">
        <Card>
          <CardHeader
            title="Beneficiaries"
            aside={<Badge>{estate.beneficiaries.length}</Badge>}
          />
          {estate.beneficiaries.length ? (
            <div className="data-list">
              {estate.beneficiaries.map((item) => (
                <div className="data-row" key={item.id}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.relationship || humanize(item.kind)}
                      {item.archivedAt ? " · Archived" : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No beneficiaries"
              description="No beneficiaries are recorded."
            />
          )}
        </Card>
        <Card>
          <CardHeader
            title="Account directives"
            aside={<Badge>{estate.directives.length}</Badge>}
          />
          {estate.directives.length ? (
            <div className="data-list">
              {estate.directives.map((item) => (
                <div className="data-row" key={item.id}>
                  <div>
                    <strong>{item.accountName}</strong>
                    <span>
                      {humanize(item.distributionMethod)} ·{" "}
                      {item.ownershipShareBps / 100}% ownership
                    </span>
                  </div>
                  <MoneyValue
                    amount={item.currentValueMinor}
                    currency={item.currency}
                  />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No directives"
              description="No account directives are recorded."
            />
          )}
        </Card>
      </div>
      <div className="detail-grid">
        <Card>
          <CardHeader
            title="Allocations"
            aside={<Badge>{estate.allocations.length}</Badge>}
          />
          {estate.allocations.length ? (
            <div className="data-list">
              {estate.allocations.map((item) => (
                <div className="data-row" key={item.id}>
                  <div>
                    <strong>{beneficiaryName(item.beneficiaryId)}</strong>
                    <span>
                      {humanize(item.tier)} · {item.allocationBps / 100}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No allocations"
              description="No directive allocations are recorded."
            />
          )}
        </Card>
        <Card>
          <CardHeader
            title="Residuary allocations"
            aside={<Badge>{estate.residuaryAllocations.length}</Badge>}
          />
          {estate.residuaryAllocations.length ? (
            <div className="data-list">
              {estate.residuaryAllocations.map((item) => (
                <div className="data-row" key={item.id}>
                  <div>
                    <strong>{beneficiaryName(item.beneficiaryId)}</strong>
                    <span>
                      {humanize(item.tier)} · {item.allocationBps / 100}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No residuary allocations"
              description="No residuary allocations are recorded."
            />
          )}
        </Card>
      </div>
      <Card className="section-block">
        <CardHeader
          title="Snapshots"
          aside={<Badge>{estate.snapshots.length}</Badge>}
        />
        {estate.snapshots.length ? (
          <div className="data-list">
            {estate.snapshots.map((item) => (
              <Link
                className="data-row"
                key={item.id}
                to={`/estate/snapshots/${item.id}`}
              >
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    Version {item.version} · values as of{" "}
                    {formatDate(item.valueAsOfDate)}
                  </span>
                </div>
                <span>{formatDate(item.generatedAt)}</span>
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No snapshots"
            description="No estate snapshots are available."
          />
        )}
      </Card>
    </>
  );
}

export function EstateSnapshotPage() {
  const { id = "" } = useParams();
  const state = useResource(() => getEstateSnapshot(id), [id]);
  return (
    <ResourceView state={state} loadingLabel="Loading snapshot...">
      {(snapshot) => (
        <>
          <PageHeader
            eyebrow={`Snapshot v${snapshot.version}`}
            title={snapshot.title}
            description={`Values as of ${formatDate(snapshot.valueAsOfDate)} · generated ${formatDate(snapshot.generatedAt)}`}
            actions={
              <Link className="secondary-button" to="/estate">
                Estate workspace
              </Link>
            }
          />
          <Card>
            <CardHeader
              title="Snapshot content"
              description={`Integrity hash ${snapshot.contentHash}`}
            />
            <SnapshotContent
              value={snapshot.content}
              currency={snapshot.baseCurrency}
            />
          </Card>
        </>
      )}
    </ResourceView>
  );
}

function SnapshotContent({
  value,
  currency,
  label,
}: {
  value: unknown;
  currency: string;
  label?: string;
}) {
  if (value === null || value === undefined)
    return <KeyValue label={label || "Value"}>Not set</KeyValue>;
  if (Array.isArray(value))
    return (
      <div className="snapshot-group">
        {label ? <h3>{humanize(label)}</h3> : null}
        {value.length ? (
          value.map((item, index) => (
            <SnapshotContent
              key={index}
              value={item}
              currency={currency}
              label={`Item ${index + 1}`}
            />
          ))
        ) : (
          <p className="read-note">None</p>
        )}
      </div>
    );
  if (typeof value === "object")
    return (
      <div className="snapshot-group">
        {label ? <h3>{humanize(label)}</h3> : null}
        <div className="key-grid">
          {Object.entries(value as Record<string, unknown>).map(
            ([key, item]) => (
              <SnapshotContent
                key={key}
                value={item}
                currency={currency}
                label={key}
              />
            ),
          )}
        </div>
      </div>
    );
  const isMoney = Boolean(
    label &&
    /(amount|value|assets|liabilities|netWorth).*minor|Minor$|^(assets|liabilities|netWorth)$/i.test(
      label,
    ),
  );
  return (
    <KeyValue label={humanize(label || "Value")}>
      {isMoney && typeof value === "string" && /^-?\d+$/.test(value) ? (
        <MoneyValue amount={value} currency={currency} />
      ) : (
        String(value)
      )}
    </KeyValue>
  );
}

export function ReviewPage() {
  const state = useResource(getAI);
  return (
    <>
      <PageHeader
        eyebrow="AI"
        title="Portfolio review"
        description="Provider metadata, availability, budget, and recent usage. Review generation remains disabled in this read-only frontend."
      />
      <ResourceView state={state}>
        {(ai) => (
          <>
            {ai.settings ? (
              <div className="metric-grid">
                <TextMetric
                  label="Provider"
                  value={humanize(ai.settings.provider)}
                />
                <TextMetric label="Model" value={ai.settings.model} />
                <TextMetric
                  label="Credential"
                  value={
                    ai.settings.hasStoredApiKey
                      ? `Stored${ai.settings.apiKeyHint ? ` · ${ai.settings.apiKeyHint}` : ""}`
                      : "Not stored"
                  }
                />
                <TextMetric
                  label="Availability"
                  value={
                    ai.reviewAvailability.available
                      ? "Available"
                      : humanize(ai.reviewAvailability.reason)
                  }
                />
              </div>
            ) : (
              <EmptyState
                title="Configure an AI provider"
                description="Provider metadata is not configured."
              />
            )}
            <Card className="section-block">
              <CardHeader title="Usage" description={ai.usage.billingMonth} />
              <div className="key-grid">
                <KeyValue label="Charged tokens">
                  {ai.usage.chargedTokens.toLocaleString()}
                </KeyValue>
                <KeyValue label="Remaining tokens">
                  {ai.usage.remainingTokens.toLocaleString()}
                </KeyValue>
                <KeyValue label="Successful reviews">
                  {ai.usage.successfulReviews}
                </KeyValue>
                <KeyValue label="Last used">
                  {formatDate(ai.usage.lastUsedAt)}
                </KeyValue>
              </div>
            </Card>
            <Card className="section-block">
              <CardHeader title="Recent requests" />
              {ai.events.length ? (
                <div className="data-list">
                  {ai.events.map((item) => (
                    <div className="data-row" key={item.id}>
                      <div>
                        <strong>{humanize(item.requestType)}</strong>
                        <span>
                          {item.model} · {formatDate(item.createdAt)}
                        </span>
                      </div>
                      <Badge
                        tone={
                          item.status === "succeeded" ? "positive" : "warning"
                        }
                      >
                        {humanize(item.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  title="No AI usage"
                  description="No provider requests have been recorded."
                />
              )}
            </Card>
          </>
        )}
      </ResourceView>
    </>
  );
}

function TextMetric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="metric">
      <KeyValue label={label}>{value}</KeyValue>
    </Card>
  );
}
