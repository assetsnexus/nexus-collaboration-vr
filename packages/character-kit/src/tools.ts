import type { ChatCompletionTool } from './types.js'

/**
 * OpenAI-compatible tool definitions executed in the browser via CharacterController
 * + AnimationDirector. Hermes server-agent mode ignores these — use an OpenAI-compatible
 * tools provider (e.g. OpenRouter) for real tool_calls.
 */
export const CHARACTER_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'character_set_emotion',
      description:
        'Set a high-level facial emotion on the loaded VRM. Names come from the live catalog (VRM1: happy/angry/sad/relaxed/surprised/neutral; VRM0 may use Joy/Fun/Sorrow). Intensity is 0–1 or 0–100 percent (30 = 30%). Prefer 20–50 while talking. The face eases in; after holdMs or the speech beat it returns to the current mood rest face (not a hard cut to neutral). Call character_list_expressions for the live catalog.',
      parameters: {
        type: 'object',
        properties: {
          emotion: {
            type: 'string',
            description:
              'Emotion id from the live catalog (happy, angry, sad, relaxed, surprised, neutral, or VRM0 Joy/Fun/Sorrow). Unknown names are ignored.',
          },
          intensity: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: '0–1 blend weight or 0–100 percent. Prefer 20–50. Default mild 0.4 if omitted in tags.',
          },
          holdMs: {
            type: 'number',
            description: 'Hold then ease back to the current mood rest face',
          },
          fadeMs: {
            type: 'number',
            description: 'Ease-in duration in ms (default ~220)',
          },
          faces: {
            type: 'array',
            description: 'Optional extra layers, e.g. [{name:"angry",weight:0.3},{name:"surprised",weight:0.1}]',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                weight: { type: 'number' },
              },
              required: ['name'],
            },
          },
        },
        required: ['emotion'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_set_expression',
      description:
        'Set a raw VRM expression / blendshape weight by exact name from character_list_expressions. Use for extras (lookLeft, Fun, custom shapes). Do NOT drive visemes (aa/ih/ou/ee/oh or A/I/U/E/O) while TTS lip-sync is playing — they will fight.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Exact expression name from the loaded VRM catalog',
          },
          weight: { type: 'number', minimum: 0, maximum: 100 },
          fadeMs: { type: 'number' },
        },
        required: ['name', 'weight'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_play_gesture',
      description:
        'Play a VRMA gesture: idle, wave, nod, think, talk, sad (see character_list_gestures). Optional emotion+intensity attaches a scored face. Optional target (@participant or scene object id) turns the body toward that reference and keeps that heading. Prefer compact tags: [wave|angry=30] [wave:@alice].',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          loop: { type: 'boolean', default: false },
          crossFade: { type: 'number', default: 0.25 },
          emotion: {
            type: 'string',
            description: 'Live catalog emotion to blend with this gesture (e.g. angry, happy)',
          },
          intensity: {
            type: 'number',
            minimum: 0,
            maximum: 100,
            description: '0–1 or 0–100 percent. Prefer 20–50.',
          },
          fadeMs: { type: 'number' },
          faces: {
            type: 'array',
            description: 'Layered faces; same as [wave|angry=30+surprised=10]',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                weight: { type: 'number' },
              },
              required: ['name'],
            },
          },
          target: {
            type: 'string',
            description:
              'Optional scene object id or @participant. The character turns toward that reference (smooth yaw) and stays facing it for the gesture.',
          },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_look_at',
      description:
        'Look at the camera, a world-space point, or clear (idle/pointer resume). World points yaw the body when the eyes cannot cover the angle (turn=true by default). Use later for 3D tool/skill objects.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            oneOf: [
              { type: 'string', enum: ['camera'] },
              {
                type: 'object',
                properties: {
                  x: { type: 'number' },
                  y: { type: 'number' },
                  z: { type: 'number' },
                },
                required: ['x', 'y', 'z'],
              },
              { type: 'null' },
            ],
          },
          turn: {
            type: 'boolean',
            description: 'Yaw the body toward a world point. Default true for xyz targets.',
          },
          holdMs: {
            type: 'number',
            description: 'Hold then return to idle/pointer look. Omit to keep looking.',
          },
        },
        required: ['target'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_wait',
      description:
        'Pause the animation timeline for ms before the next tool/step. Use between gestures for timing (e.g. nod, wait 400, talk).',
      parameters: {
        type: 'object',
        properties: {
          ms: { type: 'number', minimum: 0, maximum: 30000 },
        },
        required: ['ms'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_run_sequence',
      description:
        'Run an ordered series of character_* actions (gesture / emotion / expression / mood / look / wait). Prefer compact [nod,2s,wave] tags for simple beats; use this tool for complex performances.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                op: {
                  type: 'string',
                  enum: [
                    'play_gesture',
                    'set_emotion',
                    'set_expression',
                    'set_mood',
                    'set_clothes',
                    'look_at',
                    'wait',
                    'character_play_gesture',
                    'character_set_emotion',
                    'character_set_expression',
                    'character_set_mood',
                    'character_set_clothes',
                    'character_look_at',
                    'character_wait',
                  ],
                },
                id: { type: 'string', description: 'gesture id when op=play_gesture' },
                emotion: {
                  type: 'string',
                  description: 'face emotion for play_gesture / set_emotion',
                },
                mood: { type: 'string', description: 'ambient mood when op=set_mood' },
                clothesId: { type: 'string' },
                clothesIds: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'native slot ids when op=set_clothes',
                },
                clothesUrl: { type: 'string' },
                intensity: {
                  type: 'number',
                  description: 'face weight 0–1 or 0–100 percent',
                },
                holdMs: { type: 'number' },
                fadeMs: { type: 'number' },
                faces: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      weight: { type: 'number' },
                    },
                    required: ['name'],
                  },
                },
                name: { type: 'string', description: 'expression name' },
                weight: { type: 'number' },
                loop: { type: 'boolean' },
                crossFade: { type: 'number' },
                ms: { type: 'number', description: 'wait duration' },
                target: {
                  description:
                    'look_at xyz/camera, or gesture/approach scene ref (@slug or object id)',
                  oneOf: [
                    { type: 'string' },
                    {
                      type: 'object',
                      properties: {
                        x: { type: 'number' },
                        y: { type: 'number' },
                        z: { type: 'number' },
                      },
                    },
                    { type: 'null' },
                  ],
                },
                turn: { type: 'boolean', description: 'yaw body toward look_at xyz' },
                from: {
                  type: 'string',
                  enum: ['front', 'from', 'left', 'right', 'back', 'top'],
                  description: 'approach direction',
                },
              },
              required: ['op'],
              additionalProperties: false,
            },
          },
        },
        required: ['steps'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_cancel',
      description:
        'Soft-cancel the current animation timeline (previous speech beat). Call before a new spoken performance if needed; the client also auto-cancels when new TTS starts.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_list_gestures',
      description: 'List available gesture ids in the loaded pack.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_list_expressions',
      description:
        'List facial expression / blendshape names on the currently loaded VRM, grouped as emotion, viseme, blink, look, custom. Call after a model change; catalogs differ (VRM1 presets vs VRM0 Joy/Fun/Sorrow).',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_list_moods',
      description:
        'List ambient presence moods and which autonomous idle routines each mood runs (micro/medium/long). Ambient life is automatic; use character_set_mood to switch.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_set_mood',
      description:
        'Set ambient presence mood (neutral|relaxed|happy|playful|curious|focused|tired|sad|excited). Changes autonomous fidgets / rest timing and default face while idle. Does not replace conversation gestures.',
      parameters: {
        type: 'object',
        properties: {
          mood: {
            type: 'string',
            description:
              'neutral | relaxed | happy | playful | curious | focused | tired | sad | excited',
          },
        },
        required: ['mood'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_list_clothes',
      description:
        'List clothing slots on the loaded VRM, grouped by category (tops, bottoms, shoes, onepiece, accessory). Call after a model change.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_set_clothes',
      description:
        'Wear clothing slots. none hides all, default shows every native slot, ids selects several at once (e.g. tops+shoes). Optional catalog overlay url adds that VRM\'s clothes on top of native slots.',
      parameters: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description:
              'none | default | one native group id, or several joined with + (tops+shoes)',
          },
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Native slot ids to show together (tops, bottoms, shoes, …)',
          },
          url: {
            type: 'string',
            description:
              'Optional overlay VRM URL. Adds that model\'s clothing meshes on top of native slots (does not replace them).',
          },
        },
        additionalProperties: false,
      },
    },
  },
]

/** Ground locomotion + teleport (registered on Hermes with character tools). */
export const CHARACTER_LOCOMOTION_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'character_walk',
      description:
        'Walk on the ground plane (Y-up, meters). Prefer forward/right (character-relative). Use objectId from scene_list_objects to walk beside a place. Optional to:{x,z} for known world points — never set y. gait picks walk/run/careful/crouch/crawl/roll (and matching clip). Long walks (>4s at walk speed) auto-run.',
      parameters: {
        type: 'object',
        properties: {
          forward: {
            type: 'number',
            description: 'Meters ahead (+) or back (−). Typical 0.4–2.5.',
          },
          right: {
            type: 'number',
            description: 'Meters right (+) or left (−). Typical 0.3–2.',
          },
          to: {
            type: 'object',
            description: 'World XZ destination (spawn origin).',
            properties: {
              x: { type: 'number' },
              z: { type: 'number' },
            },
            required: ['x', 'z'],
          },
          objectId: {
            type: 'string',
            description: 'Walk to stand beside this scene object (same pose as teleport).',
          },
          side: {
            type: 'string',
            enum: ['front', 'back', 'left', 'right'],
            description: 'With objectId: where to stand (default front = front-to-front).',
          },
          distance: {
            type: 'number',
            description: 'With objectId: meters past object radius (default 1).',
          },
          orbitDeg: {
            type: 'number',
            description: 'With objectId: orbit degrees from front; overrides side.',
          },
          face: {
            description:
              'Facing after arrive (no objectId): keep (default — preserves turn→walk squares) | movement | camera | yaw degrees. With objectId always face the object.',
            oneOf: [
              { type: 'string', enum: ['camera', 'movement', 'keep'] },
              { type: 'number' },
            ],
          },
          speed: {
            type: 'number',
            description: 'm/s (default from gait; walk=1.4, run=2.4, careful=0.9, crouch=0.7, crawl=0.45). Wins over gait nominal.',
          },
          gait: {
            type: 'string',
            enum: ['walk', 'run', 'careful', 'crouch', 'crawl', 'roll'],
            description:
              'Locomotion style / clip. If omitted, inferred from speed (or walk). Distances that would take >4s at walk speed auto-upgrade to run unless gait is crawl/crouch/careful/roll.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_turn',
      description:
        'Turn in place. degrees: +right / −left (clockwise from above). Optional speed in deg/s (default ~120).',
      parameters: {
        type: 'object',
        properties: {
          degrees: { type: 'number' },
          speed: { type: 'number', description: 'deg/s (default 120, clamp 30–360)' },
        },
        required: ['degrees'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_stop',
      description: 'Cancel locomotion seek; hold pose. Stick/keyboard still work.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_jump',
      description: 'Hop in place (same impulse as Space when keyboard walk is on).',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_teleport',
      description:
        'Instant relocate. Prefer objectId from scene_list_objects. Stand on side (default front-to-front), distance meters past object radius; always face the object. World x/z allowed for debug.',
      parameters: {
        type: 'object',
        properties: {
          objectId: { type: 'string' },
          side: {
            type: 'string',
            enum: ['front', 'back', 'left', 'right'],
            description: 'Where to stand around the object (default front).',
          },
          distance: {
            type: 'number',
            description: 'Meters past object radius (default 1, 0 = adjacent).',
          },
          orbitDeg: {
            type: 'number',
            description: 'Orbit degrees from object front; overrides side.',
          },
          x: { type: 'number', description: 'World X when objectId omitted' },
          z: { type: 'number', description: 'World Z when objectId omitted' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_approach',
      description:
        'Walk to stand beside a scene object or @participant. from=front|left|right|back|top (top = hop onto if the avatar can leave the ground). gait/run optional; default auto so the approach takes under 5s. Faces the target on arrival.',
      parameters: {
        type: 'object',
        properties: {
          target: {
            type: 'string',
            description: 'Scene object id or @participant',
          },
          objectId: { type: 'string', description: 'Alias of target' },
          from: {
            type: 'string',
            enum: ['front', 'from', 'left', 'right', 'back', 'top'],
            description: 'Approach direction (from = front). Default front.',
          },
          side: {
            type: 'string',
            enum: ['front', 'back', 'left', 'right'],
            description: 'Alias of from for ground approaches.',
          },
          distance: {
            type: 'number',
            description: 'Meters past object radius (default 1). Ignored for from=top.',
          },
          gait: {
            type: 'string',
            enum: ['walk', 'run', 'careful', 'crouch', 'crawl', 'roll'],
          },
          speed: { type: 'number', description: 'm/s; overrides auto duration' },
          run: { type: 'boolean', description: 'Force run gait' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'character_turn_to',
      description:
        'Turn in place to face a scene object or @participant. Smooth yaw; stays on that heading until the next walk/look.',
      parameters: {
        type: 'object',
        properties: {
          target: { type: 'string', description: 'Scene object id or @participant' },
          objectId: { type: 'string' },
          speed: { type: 'number', description: 'deg/s (default 120)' },
        },
        additionalProperties: false,
      },
    },
  },
]

/** Scene catalog tools — prefix scene_ (not character_). */
export const SCENE_TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'scene_list_objects',
      description:
        'List named places/props in the 3D scene (id, kind, position, yaw, radius, tags). Call before teleport/walk with objectId. Optional filters + limit.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Case-insensitive match on id, label, description',
          },
          kind: {
            type: 'string',
            description: 'landmark | prop | seat | camera',
          },
          tag: { type: 'string', description: 'Require this tag' },
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Restrict to these ids',
          },
          limit: {
            type: 'number',
            description: 'Max rows (default 20, max 50). Response includes total match count.',
          },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene_overview',
      description:
        'Compact scene summary around this avatar: nearby objects/avatars with kind, label, xz, distance, yaw, tags. radius meters (default 20). Prefer this over scene_list_objects to avoid bloating context.',
      parameters: {
        type: 'object',
        properties: {
          radius: {
            type: 'number',
            description: 'Meters from the calling avatar (default 20, max 80).',
          },
          radiusM: { type: 'number', description: 'Alias of radius' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene_get_object',
      description: 'Get one scene object by id (metadata + pose). Also accepts @participant ids.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          target: { type: 'string', description: 'Alias of id (@participant or object id)' },
        },
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene_move_object',
      description:
        'Smoothly move a prop/landmark (not avatars). Default easing ~0.9s with a ground tracing line like a walk trail. to:{x,y,z} world meters.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          to: {
            type: 'object',
            properties: {
              x: { type: 'number' },
              y: { type: 'number' },
              z: { type: 'number' },
            },
          },
          durationMs: { type: 'number', description: 'Animation length (default 900, max 12000)' },
          smooth: { type: 'boolean', default: true },
          trail: { type: 'boolean', default: true },
          trailColor: { type: 'string', description: 'CSS hex for the tracing line' },
        },
        required: ['id', 'to'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scene_glow_object',
      description: 'Pulse an object with a configurable emissive glow, then fade.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          color: { type: 'string', description: 'CSS hex or name (default #66ccff)' },
          durationMs: { type: 'number', description: 'Default 1800' },
          intensity: { type: 'number', description: 'Emissive intensity (default 1.2)' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
  },
]

/** Aliases accepted inbound — short names, dotted character.*, extras. */
export const CHARACTER_TOOL_ALIASES: Record<string, string> = {
  soft_cancel: 'character_cancel',
  cancel: 'character_cancel',
  walk_to: 'character_walk',
  'character.walk_to': 'character_walk',
  character_walk_to: 'character_walk',
  tp: 'character_teleport',
  teleport: 'character_teleport',
  jump: 'character_jump',
  turn: 'character_turn',
  walk: 'character_walk',
  stop: 'character_stop',
  list_objects: 'scene_list_objects',
  'scene.list_objects': 'scene_list_objects',
  get_object: 'scene_get_object',
  'scene.get_object': 'scene_get_object',
  overview: 'scene_overview',
  'scene.overview': 'scene_overview',
  approach: 'character_approach',
  turn_to: 'character_turn_to',
  turnto: 'character_turn_to',
  move_object: 'scene_move_object',
  glow: 'scene_glow_object',
  glow_object: 'scene_glow_object',
}

for (const def of [
  ...CHARACTER_TOOL_DEFINITIONS,
  ...CHARACTER_LOCOMOTION_TOOL_DEFINITIONS,
]) {
  const canonical = def.function.name
  const action = canonical.replace(/^character_/, '')
  CHARACTER_TOOL_ALIASES[action] = canonical
  CHARACTER_TOOL_ALIASES[`character.${action}`] = canonical
}

for (const def of SCENE_TOOL_DEFINITIONS) {
  const canonical = def.function.name
  const action = canonical.replace(/^scene_/, '')
  CHARACTER_TOOL_ALIASES[action] = canonical
  CHARACTER_TOOL_ALIASES[`scene.${action}`] = canonical
}

const CANONICAL_CHARACTER_TOOLS = new Set(
  [
    ...CHARACTER_TOOL_DEFINITIONS,
    ...CHARACTER_LOCOMOTION_TOOL_DEFINITIONS,
    ...SCENE_TOOL_DEFINITIONS,
  ].map((t) => t.function.name),
)

export const CHARACTER_IMMEDIATE_TOOLS = new Set([
  'character_list_gestures',
  'character_list_expressions',
  'character_list_moods',
  'character_set_mood',
  'character_list_clothes',
  'character_set_clothes',
  'character_cancel',
  'character_walk',
  'character_turn',
  'character_stop',
  'character_jump',
  'character_teleport',
  'character_approach',
  'character_turn_to',
  'scene_list_objects',
  'scene_get_object',
  'scene_overview',
  'scene_move_object',
  'scene_glow_object',
])

export const CHARACTER_DEFERRED_TOOLS = new Set([
  'character_play_gesture',
  'character_run_sequence',
  'character_set_emotion',
  'character_set_expression',
  'character_look_at',
  'character_wait',
])

/**
 * Map any inbound name (character_play_gesture, character.play_gesture, play_gesture)
 * onto the canonical character_* / scene_* name. Unknown names pass through unchanged.
 */
export function resolveCharacterToolName(name: string): string {
  const raw = name.trim()
  if (!raw) return raw
  let n = raw
  if (n.startsWith('character.')) n = `character_${n.slice('character.'.length)}`
  if (n.startsWith('scene.')) n = `scene_${n.slice('scene.'.length)}`
  const aliased = CHARACTER_TOOL_ALIASES[n]
  if (aliased) return aliased
  if (CANONICAL_CHARACTER_TOOLS.has(n)) return n
  // Do not rewrite scene_* into character_scene_*
  if (n.startsWith('scene_')) return n
  const prefixed = n.startsWith('character_') ? n : `character_${n}`
  if (CANONICAL_CHARACTER_TOOLS.has(prefixed)) return prefixed
  return n
}

export function isCharacterSkillTool(name: string): boolean {
  return CANONICAL_CHARACTER_TOOLS.has(resolveCharacterToolName(name))
}

export function isImmediateCharacterTool(name: string): boolean {
  return CHARACTER_IMMEDIATE_TOOLS.has(resolveCharacterToolName(name))
}

export function isDeferredCharacterTool(name: string): boolean {
  return CHARACTER_DEFERRED_TOOLS.has(resolveCharacterToolName(name))
}
