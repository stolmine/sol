import convert from "convert-units";
import {
	formatConvertedValue,
	normalizeUnit,
	type TemporaryResult,
} from "stores/ui.store.helpers";

const CONV_ALIAS_REGEX = /^conv(?:\s|$)/i;
const CONV_QUERY_REGEX =
	/^conv\s+(?<amount>-?\d*\.?\d+)\s*(?<from>[a-z]+)\s+(?:(?:to|in)\s+)?(?:-?\d*\.?\d+\s*)?(?<to>[a-z]+)$/i;
const CURRENCY_CODE_REGEX = /^[a-z]{3}$/i;

export type ConvQueryResult =
	| { kind: "none" }
	| { kind: "result"; result: TemporaryResult }
	| {
			kind: "currency";
			amount: number;
			amountLabel: string;
			from: string;
			to: string;
	  };

function volumeOunceVariant(unit: string) {
	return unit === "oz" ? "fl-oz" : unit;
}

function convertUnits(amount: number, from: string, to: string) {
	const candidates: Array<[string, string]> = [
		[from, to],
		[volumeOunceVariant(from), volumeOunceVariant(to)],
	];

	for (const [candidateFrom, candidateTo] of candidates) {
		try {
			const value = convert(amount)
				.from(candidateFrom as convert.Unit)
				.to(candidateTo as convert.Unit);
			return { from: candidateFrom, to: candidateTo, value };
		} catch {}
	}

	return null;
}

export function isConvQuery(query: string) {
	return CONV_ALIAS_REGEX.test(query.trim());
}

export function parseConvQuery(query: string): ConvQueryResult {
	const normalized = query.trim().replace(/,/g, "").replace(/\s+/g, " ");
	const match = normalized.match(CONV_QUERY_REGEX);
	if (!match?.groups) {
		return { kind: "none" };
	}

	const amount = Number.parseFloat(match.groups.amount);
	if (Number.isNaN(amount)) {
		return { kind: "none" };
	}

	const fromUnit = normalizeUnit(match.groups.from);
	const toUnit = normalizeUnit(match.groups.to);
	const amountLabel = formatConvertedValue(amount);

	const unitResult = convertUnits(amount, fromUnit, toUnit);
	if (unitResult != null) {
		return {
			kind: "result",
			result: {
				kind: "comparison",
				left: { label: unitResult.from, value: amountLabel },
				right: {
					label: unitResult.to,
					value: formatConvertedValue(unitResult.value),
				},
			},
		};
	}

	if (
		CURRENCY_CODE_REGEX.test(match.groups.from) &&
		CURRENCY_CODE_REGEX.test(match.groups.to)
	) {
		return {
			kind: "currency",
			amount,
			amountLabel,
			from: match.groups.from.toUpperCase(),
			to: match.groups.to.toUpperCase(),
		};
	}

	return { kind: "none" };
}
