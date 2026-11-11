const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type NamingObjectAddCommand = {
  action: "add";
  name: string;
  description: string;
  priceAmount: number;
  photoUrl: string | null;
  publish: boolean;
  isTest?: boolean;
};

export type NamingObjectEditCommand = {
  action: "edit";
  id: string;
  name?: string;
  description?: string;
  priceAmount?: number;
  photoUrl?: string | null;
  publish?: boolean;
};

export type NamingObjectCommand =
  | { action: "list" }
  | NamingObjectAddCommand
  | NamingObjectEditCommand;

export function parseNamingObjectCommand(
  argv: string[],
): NamingObjectCommand | undefined {
  const [action, ...rest] = argv;
  if (action === "list") {
    return rest.length === 0 ? { action: "list" } : undefined;
  }
  if (action === "add") {
    return parseAdd(rest);
  }
  if (action === "edit") {
    return parseEdit(rest);
  }
  return undefined;
}

export function usageText(): string {
  return [
    "Usage: npm run naming:object:dev -- list",
    '   or: npm run naming:object:dev -- add --name "Goat shed" --price 2000 [--description "..."] [--photo-url URL] [--publish]',
    '   or: npm run naming:object:dev -- edit --id <uuid> [--name "..."] [--description "..."] [--price 2000] [--photo-url URL] [--publish | --unpublish]',
    "Price is integer CAD cents. New objects stay unpublished unless --publish is set.",
  ].join("\n");
}

function parseAdd(argv: string[]): NamingObjectAddCommand | undefined {
  const flags = readFlags(argv);
  if (!flags) {
    return undefined;
  }
  const name = flags.values.name?.trim();
  const priceAmount = parsePrice(flags.values.price);
  if (!name || priceAmount === undefined || flags.publish === "conflict") {
    return undefined;
  }
  return {
    action: "add",
    name,
    description: flags.values.description?.trim() ?? "",
    priceAmount,
    photoUrl: optionalText(flags.values["photo-url"]),
    publish: flags.publish === true,
  };
}

function parseEdit(argv: string[]): NamingObjectEditCommand | undefined {
  const flags = readFlags(argv);
  if (!flags) {
    return undefined;
  }
  const id = flags.values.id?.trim();
  if (!id || !UUID_PATTERN.test(id) || flags.publish === "conflict") {
    return undefined;
  }
  const command: NamingObjectEditCommand = { action: "edit", id };
  if (flags.values.name !== undefined) {
    const name = flags.values.name.trim();
    if (!name) {
      return undefined;
    }
    command.name = name;
  }
  if (flags.values.description !== undefined) {
    command.description = flags.values.description.trim();
  }
  if (flags.values.price !== undefined) {
    const priceAmount = parsePrice(flags.values.price);
    if (priceAmount === undefined) {
      return undefined;
    }
    command.priceAmount = priceAmount;
  }
  if (flags.values["photo-url"] !== undefined) {
    command.photoUrl = optionalText(flags.values["photo-url"]);
  }
  if (flags.publish === true || flags.publish === false) {
    command.publish = flags.publish;
  }
  const hasChange =
    command.name !== undefined ||
    command.description !== undefined ||
    command.priceAmount !== undefined ||
    command.photoUrl !== undefined ||
    command.publish !== undefined;
  return hasChange ? command : undefined;
}

function parsePrice(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/.test(value)) {
    return undefined;
  }
  const priceAmount = Number(value);
  if (!Number.isSafeInteger(priceAmount)) {
    return undefined;
  }
  return priceAmount;
}

function optionalText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function readFlags(argv: string[]):
  | {
      values: Partial<
        Record<"name" | "description" | "price" | "photo-url" | "id", string>
      >;
      publish: boolean | "conflict" | undefined;
    }
  | undefined {
  const values: Partial<
    Record<"name" | "description" | "price" | "photo-url" | "id", string>
  > = {};
  let publish: boolean | "conflict" | undefined;
  const known = new Set(["name", "description", "price", "photo-url", "id"]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--publish") {
      publish = publish === false ? "conflict" : true;
      continue;
    }
    if (arg === "--unpublish") {
      publish = publish === true ? "conflict" : false;
      continue;
    }
    const matched = /^--([^=]+)(?:=([\s\S]*))?$/.exec(arg);
    if (!matched || !known.has(matched[1])) {
      return undefined;
    }
    const name = matched[1] as "name" | "description" | "price" | "photo-url" | "id";
    const value = matched[2] ?? argv[index + 1];
    if (matched[2] === undefined) {
      index += 1;
    }
    if (value === undefined || value.startsWith("--")) {
      return undefined;
    }
    values[name] = value;
  }

  return { values, publish };
}
