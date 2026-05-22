export type DeploymentConfig = {
  awsRegion: string;
  bedrockModel: string;
  profileName: string;
  stackName: string;
  apiBaseUrl: string;
};

export type DeploymentPhase =
  | "not_configured"
  | "configured"
  | "starting"
  | "running"
  | "ending"
  | "stopped"
  | "failed"
  | "rollback";

export type DeploymentStatus = {
  phase: DeploymentPhase;
  stackStatus?: string;
  message: string;
  lastCheckedAt?: string;
};

export type ApiConnectionState = "not_configured" | "configured" | "connecting" | "connected" | "error";

export type ApiConnectionStatus = {
  state: ApiConnectionState;
  apiBaseUrl: string;
  message: string;
  lastCheckedAt?: string;
};

export type CharacterActionDefinition = {
  id: string;
  name: string;
  type: string;
  triggerInstructions: string;
  payloadTemplate?: unknown;
  enabled: boolean;
};

export type CharacterSyncStatus = "mock" | "local_only" | "api_synced" | "api_pending" | "conflict" | "deleted";

export type CharacterRecord = {
  id: string;
  displayName: string;
  description: string;
  archetype?: string;
  status?: string;
  actions: CharacterActionDefinition[];
  syncStatus: CharacterSyncStatus;
  localFilePath?: string;
  apiUpdatedAt?: string;
  localUpdatedAt?: string;
};

export type CharacterFolderState = "not_configured" | "ready" | "missing" | "syncing" | "error";

export type CharacterFolderStatus = {
  state: CharacterFolderState;
  path?: string;
  message: string;
  lastSyncAt?: string;
};

export type SharedDashboardState = {
  apiConnection: ApiConnectionStatus;
  deployment: DeploymentStatus;
  characters: CharacterRecord[];
  selectedCharacterId?: string;
  characterFolder: CharacterFolderStatus;
};

export type DashboardReadiness = {
  canLoadCharacters: boolean;
  canChat: boolean;
  deploymentNeedsAttention: boolean;
  hasCharacters: boolean;
  needsDeploymentSetup: boolean;
  selectedCharacterReady: boolean;
  welcomeTone: "empty" | "needs_connection" | "ready" | "error";
};

function clean(value: string | undefined): string {
  return value?.trim() ?? "";
}

export function buildDeploymentConfig(input: {
  awsRegion: string;
  bedrockModel: string;
  profileName: string;
  stackName: string;
  apiBaseUrl?: string;
}): DeploymentConfig {
  return {
    apiBaseUrl: clean(input.apiBaseUrl),
    awsRegion: clean(input.awsRegion),
    bedrockModel: clean(input.bedrockModel),
    profileName: clean(input.profileName),
    stackName: clean(input.stackName)
  };
}

export function isApiConnected(status: ApiConnectionStatus): boolean {
  return status.state === "connected" && status.apiBaseUrl.length > 0;
}

export function isDeploymentRunning(status: DeploymentStatus): boolean {
  if (status.phase === "running") {
    return true;
  }
  return Boolean(status.stackStatus && /^(CREATE|UPDATE)_COMPLETE$/.test(status.stackStatus));
}

export function deploymentNeedsAttention(status: DeploymentStatus): boolean {
  return status.phase === "failed" || status.phase === "rollback" || Boolean(status.stackStatus && /ROLLBACK|FAILED/.test(status.stackStatus));
}

export function toCharacterRecord(input: {
  id: string;
  name: string;
  description: string;
  archetype?: string;
  status?: string;
  allowedActions?: string[];
  actions?: Array<Partial<CharacterActionDefinition> & { id?: string; type: string; name?: string }>;
  syncStatus?: CharacterSyncStatus;
  localFilePath?: string;
  apiUpdatedAt?: string;
  localUpdatedAt?: string;
}): CharacterRecord {
  const actionDefinitions = input.actions?.length
    ? input.actions.map((action) => ({
        id: action.id ?? action.type,
        name: action.name ?? action.type,
        type: action.type,
        triggerInstructions: action.triggerInstructions ?? "",
        payloadTemplate: action.payloadTemplate,
        enabled: action.enabled ?? true
      }))
    : (input.allowedActions ?? []).map((actionType) => ({
        id: actionType,
        name: actionType,
        type: actionType,
        triggerInstructions: "",
        enabled: true
      }));

  return {
    id: input.id,
    displayName: input.name,
    description: input.description,
    archetype: input.archetype,
    status: input.status,
    actions: actionDefinitions,
    syncStatus: input.syncStatus ?? "mock",
    localFilePath: input.localFilePath,
    apiUpdatedAt: input.apiUpdatedAt,
    localUpdatedAt: input.localUpdatedAt
  };
}

export function toApiConnectionStatus(input: { apiBaseUrl: string; state: "mock" | "idle" | "loading" | "success" | "error"; message: string }): ApiConnectionStatus {
  const apiBaseUrl = clean(input.apiBaseUrl);
  if (!apiBaseUrl) {
    return { apiBaseUrl, message: input.message, state: "not_configured" };
  }
  const stateMap: Record<typeof input.state, ApiConnectionState> = {
    error: "error",
    idle: "configured",
    loading: "connecting",
    mock: "not_configured",
    success: "connected"
  };
  return { apiBaseUrl, message: input.message, state: stateMap[input.state] };
}

export function toDeploymentStatus(input: { configured: boolean; state: "mock" | "idle" | "loading" | "success" | "error"; message: string; stackStatus?: string }): DeploymentStatus {
  if (!input.configured) {
    return { message: input.message, phase: "not_configured", stackStatus: input.stackStatus };
  }
  if (input.stackStatus && /ROLLBACK/.test(input.stackStatus)) {
    return { message: input.message, phase: "rollback", stackStatus: input.stackStatus };
  }
  const phaseMap: Record<typeof input.state, DeploymentPhase> = {
    error: "failed",
    idle: "configured",
    loading: "starting",
    mock: "not_configured",
    success: "running"
  };
  return { message: input.message, phase: phaseMap[input.state], stackStatus: input.stackStatus };
}

export function buildSharedDashboardState(state: SharedDashboardState): SharedDashboardState {
  return state;
}

export function getDashboardReadiness(state: SharedDashboardState): DashboardReadiness {
  const apiReady = isApiConnected(state.apiConnection);
  const attention = deploymentNeedsAttention(state.deployment) || state.apiConnection.state === "error" || state.characterFolder.state === "error";
  const hasCharacters = state.characters.length > 0;
  const selectedCharacterReady = Boolean(state.selectedCharacterId && state.characters.some((character) => character.id === state.selectedCharacterId));
  const needsDeploymentSetup = state.apiConnection.state === "not_configured" && state.deployment.phase === "not_configured";

  return {
    canLoadCharacters: apiReady,
    canChat: apiReady && hasCharacters && selectedCharacterReady,
    deploymentNeedsAttention: attention,
    hasCharacters,
    needsDeploymentSetup,
    selectedCharacterReady,
    welcomeTone: attention ? "error" : needsDeploymentSetup ? "empty" : apiReady ? "ready" : "needs_connection"
  };
}

export function getWelcomeEmptyState(state: SharedDashboardState): string {
  const readiness = getDashboardReadiness(state);
  if (readiness.deploymentNeedsAttention) {
    return "Deployment needs attention before CharacterForgeAI is ready.";
  }
  if (readiness.needsDeploymentSetup) {
    return "No AWS backend connected yet. Go to Deployment to launch or connect your CharacterForgeAI stack.";
  }
  if (!readiness.canLoadCharacters) {
    return "Settings are configured but not connected. Test the connection from Settings or Deployment.";
  }
  if (!readiness.hasCharacters) {
    return "Connected with no characters yet. Create or import a character to start chatting.";
  }
  return "CharacterForgeAI is ready.";
}
