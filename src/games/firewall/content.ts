export type FirewallDirection = 'N' | 'E' | 'S' | 'W';
export type FirewallRotation = 0 | 180;
export type FirewallColor = 'blue' | 'green';
export type FirewallTool = 'pickaxe' | 'lantern' | 'cart';
export type FirewallRole = 'blue' | 'green' | 'saboteur' | 'boss' | 'profiteer' | 'geologist';
export interface FirewallPathDefinition {
  id: string; quantity: number; components: readonly (readonly FirewallDirection[])[];
  ladderComponent?: number; door?: { color: FirewallColor; component: number };
  crystals?: number; crystalComponent?: number; feature?: string;
}
/** Component membership is factual card geometry: distinct components never join inside a tile. */
export const FIREWALL_PATH_DEFINITIONS = [
  {
    "id": "base_nsw",
    "quantity": 5,
    "components": [
      [
        "N",
        "S",
        "W"
      ]
    ]
  },
  {
    "id": "base_nesw",
    "quantity": 5,
    "components": [
      [
        "N",
        "E",
        "S",
        "W"
      ]
    ]
  },
  {
    "id": "base_es",
    "quantity": 4,
    "components": [
      [
        "E",
        "S"
      ]
    ]
  },
  {
    "id": "base_sw",
    "quantity": 5,
    "components": [
      [
        "S",
        "W"
      ]
    ]
  },
  {
    "id": "base_ns",
    "quantity": 4,
    "components": [
      [
        "N",
        "S"
      ]
    ]
  },
  {
    "id": "base_ew",
    "quantity": 3,
    "components": [
      [
        "E",
        "W"
      ]
    ]
  },
  {
    "id": "base_new",
    "quantity": 5,
    "components": [
      [
        "N",
        "E",
        "W"
      ]
    ]
  },
  {
    "id": "base_dead_new",
    "quantity": 1,
    "components": [
      [
        "N"
      ],
      [
        "E"
      ],
      [
        "W"
      ]
    ]
  },
  {
    "id": "base_dead_nes",
    "quantity": 1,
    "components": [
      [
        "N"
      ],
      [
        "E"
      ],
      [
        "S"
      ]
    ]
  },
  {
    "id": "base_dead_nw",
    "quantity": 1,
    "components": [
      [
        "N"
      ],
      [
        "W"
      ]
    ]
  },
  {
    "id": "base_dead_ew",
    "quantity": 1,
    "components": [
      [
        "E"
      ],
      [
        "W"
      ]
    ]
  },
  {
    "id": "base_dead_nesw",
    "quantity": 1,
    "components": [
      [
        "N"
      ],
      [
        "E"
      ],
      [
        "S"
      ],
      [
        "W"
      ]
    ]
  },
  {
    "id": "base_dead_w",
    "quantity": 1,
    "components": [
      [
        "W"
      ]
    ]
  },
  {
    "id": "base_dead_n",
    "quantity": 1,
    "components": [
      [
        "N"
      ]
    ]
  },
  {
    "id": "base_dead_ne",
    "quantity": 1,
    "components": [
      [
        "N"
      ],
      [
        "E"
      ]
    ]
  },
  {
    "id": "base_dead_ns",
    "quantity": 1,
    "components": [
      [
        "N"
      ],
      [
        "S"
      ]
    ]
  },
  {
    "id": "exp_bridge",
    "quantity": 2,
    "components": [
      [
        "N",
        "S"
      ],
      [
        "E",
        "W"
      ]
    ],
    "feature": "bridge"
  },
  {
    "id": "exp_double_nw_es",
    "quantity": 1,
    "components": [
      [
        "N",
        "W"
      ],
      [
        "E",
        "S"
      ]
    ],
    "feature": "double_bend"
  },
  {
    "id": "exp_double_ne_sw",
    "quantity": 1,
    "components": [
      [
        "N",
        "E"
      ],
      [
        "S",
        "W"
      ]
    ],
    "feature": "double_bend"
  },
  {
    "id": "exp_mixed_ns_e_w",
    "quantity": 1,
    "components": [
      [
        "N",
        "S"
      ],
      [
        "E"
      ],
      [
        "W"
      ]
    ]
  },
  {
    "id": "exp_mixed_ns_e",
    "quantity": 1,
    "components": [
      [
        "N",
        "S"
      ],
      [
        "E"
      ]
    ]
  },
  {
    "id": "exp_mixed_es_n",
    "quantity": 2,
    "components": [
      [
        "E",
        "S"
      ],
      [
        "N"
      ]
    ]
  },
  {
    "id": "exp_mixed_ne_s",
    "quantity": 1,
    "components": [
      [
        "N",
        "E"
      ],
      [
        "S"
      ]
    ]
  },
  {
    "id": "exp_mixed_ew_n_s",
    "quantity": 1,
    "components": [
      [
        "E",
        "W"
      ],
      [
        "N"
      ],
      [
        "S"
      ]
    ]
  },
  {
    "id": "exp_ladder_nw",
    "quantity": 1,
    "components": [
      [
        "N",
        "W"
      ]
    ],
    "ladderComponent": 0
  },
  {
    "id": "exp_ladder_s",
    "quantity": 1,
    "components": [
      [
        "S"
      ]
    ],
    "ladderComponent": 0
  },
  {
    "id": "exp_ladder_ne",
    "quantity": 1,
    "components": [
      [
        "N",
        "E"
      ]
    ],
    "ladderComponent": 0
  },
  {
    "id": "exp_ladder_w",
    "quantity": 1,
    "components": [
      [
        "W"
      ]
    ],
    "ladderComponent": 0
  },
  {
    "id": "exp_blue_sw",
    "quantity": 1,
    "components": [
      [
        "S",
        "W"
      ]
    ],
    "door": {
      "color": "blue",
      "component": 0
    }
  },
  {
    "id": "exp_blue_ew",
    "quantity": 1,
    "components": [
      [
        "E",
        "W"
      ]
    ],
    "door": {
      "color": "blue",
      "component": 0
    }
  },
  {
    "id": "exp_blue_ns",
    "quantity": 1,
    "components": [
      [
        "N",
        "S"
      ]
    ],
    "door": {
      "color": "blue",
      "component": 0
    }
  },
  {
    "id": "exp_green_es",
    "quantity": 1,
    "components": [
      [
        "E",
        "S"
      ]
    ],
    "door": {
      "color": "green",
      "component": 0
    }
  },
  {
    "id": "exp_green_ew",
    "quantity": 1,
    "components": [
      [
        "E",
        "W"
      ]
    ],
    "door": {
      "color": "green",
      "component": 0
    }
  },
  {
    "id": "exp_green_ns_e",
    "quantity": 1,
    "components": [
      [
        "N",
        "S"
      ],
      [
        "E"
      ]
    ],
    "door": {
      "color": "green",
      "component": 0
    }
  },
  {
    "id": "exp_crystal_nes",
    "quantity": 1,
    "components": [
      [
        "N",
        "E",
        "S"
      ]
    ],
    "crystals": 1,
    "crystalComponent": 0
  },
  {
    "id": "exp_crystal_s",
    "quantity": 1,
    "components": [
      [
        "S"
      ]
    ],
    "crystals": 1,
    "crystalComponent": 0
  },
  {
    "id": "exp_crystal_esw",
    "quantity": 3,
    "components": [
      [
        "E",
        "S",
        "W"
      ]
    ],
    "crystals": 1,
    "crystalComponent": 0
  },
  {
    "id": "exp_crystal_nsw_e",
    "quantity": 1,
    "components": [
      [
        "N",
        "S",
        "W"
      ],
      [
        "E"
      ]
    ],
    "crystals": 1,
    "crystalComponent": 0
  },
  {
    "id": "exp_crystal_w",
    "quantity": 1,
    "components": [
      [
        "W"
      ]
    ],
    "crystals": 1,
    "crystalComponent": 0
  },
  {
    "id": "exp_crystal_nesw",
    "quantity": 1,
    "components": [
      [
        "N",
        "E",
        "S",
        "W"
      ]
    ],
    "crystals": 1,
    "crystalComponent": 0
  },
  {
    "id": "exp_crystal_esw_n",
    "quantity": 1,
    "components": [
      [
        "E",
        "S",
        "W"
      ],
      [
        "N"
      ]
    ],
    "crystals": 1,
    "crystalComponent": 0
  },
  {
    "id": "exp_crystal_ew_s",
    "quantity": 1,
    "components": [
      [
        "E",
        "W"
      ],
      [
        "S"
      ]
    ],
    "crystals": 1,
    "crystalComponent": 0
  },
  {
    "id": "start",
    "quantity": 1,
    "components": [
      [
        "N",
        "E",
        "S",
        "W"
      ]
    ],
    "ladderComponent": 0
  },
  {
    "id": "goal_gold",
    "quantity": 1,
    "components": [
      [
        "N",
        "E",
        "S",
        "W"
      ]
    ]
  },
  {
    "id": "goal_stone_ne",
    "quantity": 1,
    "components": [
      [
        "N",
        "E"
      ]
    ]
  },
  {
    "id": "goal_stone_es",
    "quantity": 1,
    "components": [
      [
        "E",
        "S"
      ]
    ]
  }
] as const satisfies readonly FirewallPathDefinition[];
export type FirewallPathID = typeof FIREWALL_PATH_DEFINITIONS[number]['id'];
export type FirewallGoalPathID = 'goal_gold' | 'goal_stone_ne' | 'goal_stone_es';
export const FIREWALL_PATHS = Object.fromEntries<FirewallPathDefinition>(FIREWALL_PATH_DEFINITIONS.map(path => [path.id, path])) as Record<FirewallPathID, FirewallPathDefinition>;
export const FIREWALL_ROLE_IDS: readonly FirewallRole[] = ['blue', 'green', 'saboteur', 'boss', 'profiteer', 'geologist'];
export const FIREWALL_ROLES: Record<FirewallRole, { name: string; count: number; description: string }> = {
  blue: { name: '藍域滲透者', count: 4, description: '替藍域建立通往核心資料的連線；綠門會阻擋本隊。' },
  green: { name: '綠域滲透者', count: 4, description: '替綠域建立通往核心資料的連線；藍門會阻擋本隊。' },
  saboteur: { name: '企業追蹤程式', count: 3, description: '阻止任何連線抵達核心資料。' },
  boss: { name: '總控架構師', count: 1, description: '可通過所有門，連線成功時參與分紅，但少領一點。' },
  profiteer: { name: '雙面代理', count: 1, description: '總是加入獲勝群體，但少領兩點，最低零點。' },
  geologist: { name: '資料採樣師', count: 2, description: '按版圖上可見的資料晶簇獲得獨立報酬。' },
};
export const FIREWALL_TOOLS: Record<FirewallTool, { name: string }> = {
  pickaxe: { name: '解密器' }, lantern: { name: '偵察模組' }, cart: { name: '傳輸器' },
};
export const FIREWALL_ACTIONS = {
  break_lantern: { name: '停用偵察模組', count: 3, tools: ['lantern'] },
  break_pickaxe: { name: '停用解密器', count: 3, tools: ['pickaxe'] },
  break_cart: { name: '停用傳輸器', count: 3, tools: ['cart'] },
  repair_lantern: { name: '修復偵察模組', count: 2, tools: ['lantern'] },
  repair_pickaxe: { name: '修復解密器', count: 2, tools: ['pickaxe'] },
  repair_cart: { name: '修復傳輸器', count: 2, tools: ['cart'] },
  repair_lantern_or_pickaxe: { name: '修復偵察或解密', count: 1, tools: ['lantern', 'pickaxe'] },
  repair_lantern_or_cart: { name: '修復偵察或傳輸', count: 1, tools: ['lantern', 'cart'] },
  repair_pickaxe_or_cart: { name: '修復解密或傳輸', count: 1, tools: ['pickaxe', 'cart'] },
  map: { name: '核心探查', count: 6, tools: [] },
  rockfall: { name: '斷線清除', count: 4, tools: [] },
  theft: { name: '竊取後門', count: 4, tools: [] },
  hands_off: { name: '封鎖竊取', count: 3, tools: [] },
  trapped: { name: '隔離監禁', count: 3, tools: [] },
  freedom: { name: '解除隔離', count: 4, tools: [] },
  inspection: { name: '身分稽核', count: 2, tools: [] },
  change_roles: { name: '重配身分', count: 2, tools: [] },
  swap_hands: { name: '交換程式', count: 2, tools: [] },
} as const;
export type FirewallActionID = keyof typeof FIREWALL_ACTIONS;
export type FirewallCard = { id: string; kind: 'path'; pathID: FirewallPathID } | { id: string; kind: 'action'; action: FirewallActionID };
export const FIREWALL_ROUND_COUNT = 3;
export const FIREWALL_GOALS = [{ id: 'goal-top', x: 8, y: -2 }, { id: 'goal-middle', x: 8, y: 0 }, { id: 'goal-bottom', x: 8, y: 2 }] as const;
export const FIREWALL_RULE_SOURCES = [
  'https://blog.amigo-spiele.de/content/ap/rule/04900-GB-AmigoRule.pdf',
  'https://blog.amigo-spiele.de/content/ap/rule/04980-GB-AmigoRule.pdf',
] as const;
export function createFirewallDeck(): FirewallCard[] {
  return [
    ...FIREWALL_PATH_DEFINITIONS.filter(path => path.id.startsWith('base_') || path.id.startsWith('exp_'))
      .flatMap(path => Array.from({ length: path.quantity }, (_, index): FirewallCard => ({ id: `path:${path.id}:${index}`, kind: 'path', pathID: path.id }))),
    ...Object.entries(FIREWALL_ACTIONS).flatMap(([action, definition]) => Array.from({ length: definition.count }, (_, index): FirewallCard =>
      ({ id: `action:${action}:${index}`, kind: 'action', action: action as FirewallActionID }))),
  ];
}
export function createFirewallRoles(): FirewallRole[] {
  return FIREWALL_ROLE_IDS.flatMap(role => Array.from({ length: FIREWALL_ROLES[role].count }, () => role));
}
