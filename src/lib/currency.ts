import axios from "axios";
import { DateTime } from "luxon";
import {
	readPersistedStore,
	writePersistedStore,
} from "stores/persisted-config";
import type { TemporaryResult } from "stores/ui.store.helpers";

const RATES_URL = "https://open.er-api.com/v6/latest/USD";
const RATES_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export type CurrencyRates = {
	rates: Record<string, number>;
	lastUpdateUnix: number;
	nextUpdateUnix: number;
	fetchedAt: number;
};

let cachedRates: CurrencyRates | null = null;
let hydration: Promise<void> | null = null;
let pendingRequest: Promise<CurrencyRates | null> | null = null;

function isValidRates(value: unknown): value is CurrencyRates {
	if (value == null || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<CurrencyRates>;
	return (
		candidate.rates != null &&
		typeof candidate.rates === "object" &&
		typeof candidate.lastUpdateUnix === "number" &&
		typeof candidate.nextUpdateUnix === "number" &&
		typeof candidate.fetchedAt === "number"
	);
}

function isStale(rates: CurrencyRates, now: number) {
	return (
		now - rates.fetchedAt > RATES_MAX_AGE_MS ||
		now > rates.nextUpdateUnix * 1000
	);
}

function hydrateRates() {
	if (hydration == null) {
		hydration = readPersistedStore<CurrencyRates>("currency")
			.then((persisted) => {
				if (cachedRates == null && isValidRates(persisted)) {
					cachedRates = persisted;
				}
			})
			.catch((e) => {
				console.log("Could not read persisted currency rates", e);
			});
	}

	return hydration;
}

async function fetchRates(): Promise<CurrencyRates | null> {
	try {
		const res = await axios.get(RATES_URL, { timeout: 8000 });
		const data = res.data;
		if (
			data?.result !== "success" ||
			data.rates == null ||
			typeof data.rates !== "object" ||
			typeof data.rates.USD !== "number"
		) {
			return null;
		}

		const rates: CurrencyRates = {
			rates: data.rates,
			lastUpdateUnix: Number(data.time_last_update_unix) || 0,
			nextUpdateUnix: Number(data.time_next_update_unix) || 0,
			fetchedAt: Date.now(),
		};
		cachedRates = rates;
		writePersistedStore("currency", rates);
		return rates;
	} catch (e) {
		console.log("Currency rates request failed", e);
		return null;
	}
}

export async function getCurrencyRates(): Promise<CurrencyRates | null> {
	await hydrateRates();

	if (cachedRates != null && !isStale(cachedRates, Date.now())) {
		return cachedRates;
	}

	if (pendingRequest == null) {
		pendingRequest = fetchRates().finally(() => {
			pendingRequest = null;
		});
	}

	const fresh = await pendingRequest;
	return fresh ?? cachedRates;
}

export function formatCurrencyValue(value: number) {
	if (!Number.isFinite(value)) {
		return value.toString();
	}

	if (value !== 0 && Math.abs(value) < 0.01) {
		return Number(value.toPrecision(3)).toString();
	}

	return value.toFixed(2);
}

export function createCurrencyResult(
	amount: number,
	amountLabel: string,
	from: string,
	to: string,
	rates: CurrencyRates,
): TemporaryResult | null {
	const fromRate = rates.rates[from];
	const toRate = rates.rates[to];
	if (
		typeof fromRate !== "number" ||
		typeof toRate !== "number" ||
		fromRate <= 0
	) {
		return null;
	}

	const updated =
		rates.lastUpdateUnix > 0
			? DateTime.fromSeconds(rates.lastUpdateUnix).toRelative()
			: null;

	return {
		kind: "comparison",
		left: { label: from, value: amountLabel },
		right: {
			label: to,
			value: formatCurrencyValue((amount * toRate) / fromRate),
		},
		footer: updated
			? `Rates from open.er-api.com · updated ${updated}`
			: "Rates from open.er-api.com",
	};
}

export async function convertCurrency(
	amount: number,
	amountLabel: string,
	from: string,
	to: string,
): Promise<TemporaryResult | null> {
	const rates = await getCurrencyRates();
	if (rates == null) {
		return null;
	}

	return createCurrencyResult(amount, amountLabel, from, to, rates);
}
