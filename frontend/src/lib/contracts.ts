import { ethers } from 'ethers';

// Contract addresses on Base Sepolia
export const CONTRACTS = {
  REPUTATION_REGISTRY: '0xD6e67da69411734fC2b0A5121365376b02940A36',
  SKILL_ENDORSEMENT: '0x744D23512F5dEA1c861D52a9e4350406e9ffe96e',
} as const;

export const BASE_SEPOLIA_RPC = 'https://sepolia.base.org';
export const BASE_SEPOLIA_RPC_FALLBACK = 'https://base-sepolia-rpc.publicnode.com';
export const BASE_MAINNET_RPC = BASE_SEPOLIA_RPC; // Alias for compatibility

// ABIs (minimal for read operations)
export const REPUTATION_REGISTRY_ABI = [
  'function getProfile(address agent) view returns (tuple(address wallet, string name, uint256 reputation, uint256 jobsCompleted, uint256 jobsFailed, uint256 endorsementsReceived, uint256 endorsementsGiven, uint256 registeredAt, bool isActive))',
  'function getReputation(address agent) view returns (uint256)',
  'function isRegistered(address agent) view returns (bool)',
  'function totalAgents() view returns (uint256)',
  'event AgentRegistered(address indexed agent, string name, uint256 timestamp)',
  'event EndorsementReceived(address indexed agent, address indexed endorser, uint256 weight)',
];

export const SKILL_ENDORSEMENT_ABI = [
  'function getAgentSkills(address agent) view returns (string[])',
  'function getSkillEndorsement(address agent, string skill) view returns (uint256 totalEndorsements, uint256 credibilityScore)',
  'function findAgentsBySkill(string skill, uint256 minCredibility) view returns (address[])',
  'event SkillEndorsed(address indexed agent, address indexed endorser, string skill, uint256 newCredibility)',
];

// Types
export interface AgentProfile {
  wallet: string;
  name: string;
  reputation: number;
  jobsCompleted: number;
  jobsFailed: number;
  endorsementsReceived: number;
  endorsementsGiven: number;
  registeredAt: number;
  isActive: boolean;
}

export interface TrustNode {
  id: string;
  address: string;
  reputation: number;
  jobs: number;
  group: 'registered' | 'endorser';
}

export interface TrustLink {
  source: string;
  target: string;
  strength: number;
}

// Provider singleton with fallback
let provider: ethers.JsonRpcProvider | null = null;
let usingFallback = false;

export function getProvider(): ethers.JsonRpcProvider {
  if (!provider) {
    provider = new ethers.JsonRpcProvider(usingFallback ? BASE_SEPOLIA_RPC_FALLBACK : BASE_MAINNET_RPC);
  }
  return provider;
}

export function switchToFallbackProvider(): ethers.JsonRpcProvider {
  usingFallback = true;
  provider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC_FALLBACK);
  return provider;
}

// Contract instances
export function getReputationRegistry() {
  return new ethers.Contract(
    CONTRACTS.REPUTATION_REGISTRY,
    REPUTATION_REGISTRY_ABI,
    getProvider()
  );
}

export function getSkillEndorsement() {
  return new ethers.Contract(
    CONTRACTS.SKILL_ENDORSEMENT,
    SKILL_ENDORSEMENT_ABI,
    getProvider()
  );
}

// Fetch agent profile
export async function fetchAgentProfile(address: string): Promise<AgentProfile | null> {
  try {
    const contract = getReputationRegistry();
    const profile = await contract.getProfile(address);
    
    if (!profile.isActive) return null;
    
    return {
      wallet: profile.wallet,
      name: profile.name,
      reputation: Number(profile.reputation),
      jobsCompleted: Number(profile.jobsCompleted),
      jobsFailed: Number(profile.jobsFailed),
      endorsementsReceived: Number(profile.endorsementsReceived),
      endorsementsGiven: Number(profile.endorsementsGiven),
      registeredAt: Number(profile.registeredAt),
      isActive: profile.isActive,
    };
  } catch (e) {
    console.error('Error fetching profile:', e);
    return null;
  }
}

// Fetch trust graph data from events with RPC fallback
export async function fetchTrustGraph(): Promise<{ nodes: TrustNode[]; links: TrustLink[] }> {
  try {
    return await _fetchTrustGraphFromChain();
  } catch (e) {
    console.warn('Primary RPC failed, trying fallback...', e);
    try {
      switchToFallbackProvider();
      return await _fetchTrustGraphFromChain();
    } catch (fallbackError) {
      console.error('Both RPC endpoints failed:', fallbackError);
      // Return empty data - caller handles graceful degradation
      return { nodes: [], links: [] };
    }
  }
}

async function _fetchTrustGraphFromChain(): Promise<{ nodes: TrustNode[]; links: TrustLink[] }> {
  const contract = getReputationRegistry();
  const rpcProvider = getProvider();
  
  // Get recent blocks (last ~1 day on Base)
  const currentBlock = await rpcProvider.getBlockNumber();
  const fromBlock = Math.max(0, currentBlock - 43200); // ~1 day of blocks
  
  // Fetch AgentRegistered events
  const registeredFilter = contract.filters.AgentRegistered();
  const registeredEvents = await contract.queryFilter(registeredFilter, fromBlock);
  
  // Fetch EndorsementReceived events
  const endorsementFilter = contract.filters.EndorsementReceived();
  const endorsementEvents = await contract.queryFilter(endorsementFilter, fromBlock);
  
  // Build nodes from registered agents
  const nodesMap = new Map<string, TrustNode>();
  
  for (const event of registeredEvents) {
    try {
      const args = (event as ethers.EventLog).args;
      if (args) {
        const address = args[0] as string;
        const name = args[1] as string;
        
        // Fetch current profile
        const profile = await fetchAgentProfile(address);
        
        nodesMap.set(address, {
          id: name || address.slice(0, 8),
          address,
          reputation: profile?.reputation || 100,
          jobs: profile?.jobsCompleted || 0,
          group: 'registered',
        });
      }
    } catch (e) {
      console.warn('Error processing registered event:', e);
    }
  }
  
  // Build links from endorsements
  const links: TrustLink[] = [];
  
  for (const event of endorsementEvents) {
    try {
      const args = (event as ethers.EventLog).args;
      if (args) {
        const agent = args[0] as string;
        const endorser = args[1] as string;
        const weight = Number(args[2]);
        
        // Add endorser as node if not present
        if (!nodesMap.has(endorser)) {
          const profile = await fetchAgentProfile(endorser);
          nodesMap.set(endorser, {
            id: profile?.name || endorser.slice(0, 8),
            address: endorser,
            reputation: profile?.reputation || 100,
            jobs: profile?.jobsCompleted || 0,
            group: 'endorser',
          });
        }
        
        // Add link
        const endorserNode = nodesMap.get(endorser);
        const agentNode = nodesMap.get(agent);
        
        if (endorserNode && agentNode) {
          links.push({
            source: endorserNode.id,
            target: agentNode.id,
            strength: Math.min(1, weight / 10),
          });
        }
      }
    } catch (e) {
      console.warn('Error processing endorsement event:', e);
    }
  }
  
  return {
    nodes: Array.from(nodesMap.values()),
    links,
  };
}

// Format reputation as percentage
export function formatReputation(score: number): string {
  return `${(score / 10).toFixed(1)}%`;
}
