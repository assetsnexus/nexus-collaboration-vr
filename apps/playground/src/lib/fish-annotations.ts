import { buildCharacterSkillPrompt, type CharacterSkillCatalog } from '@nexus/character-kit'

/** Fish Audio S2 inline annotation reference — stays in TTS text, stripped from chat UI. */
export const FISH_TTS_ANNOTATION_GUIDE = `
## Fish Audio TTS annotations (S2 — leave these tags IN the spoken text)
These are voice/prosody cues for the TTS engine, NOT character motion. The client keeps them for Fish and hides them in the chat UI.

Basic emotions: [happy] [sad] [angry] [excited] [calm] [nervous] [confident] [surprised]
[satisfied] [delighted] [scared] [worried] [upset] [frustrated] [empathetic] [embarrassed]
[proud] [relaxed] [grateful] [curious] [sarcastic] [hopeful] [determined]

Tone: [whispering] [soft tone] [shouting] [screaming] [in a hurry tone] [emphasis]
Effects: [laughing] [chuckling] [sighing] [gasping] [clear throat] [break] [long-break]
Free-form OK: [warm and happy] [slightly sad] [very excited]

Examples:
[happy] Why did the scarecrow win an award? [break] [chuckling] Because he was outstanding in his field!

Motion uses comma chains with no requirement to match Fish: [nod,2s,wave] is stripped from TTS.
Scored 3D faces use a number: [wave|happy=30] or [happy=35]. Bare [happy] is voice-only.
Fish phrases use spaces: [soft tone]. Prefer one primary Fish emotion per sentence.
`.trim()

export function buildCharacterSystemPrompt(opts: {
  basePrompt: string
  ttsEnabled: boolean
  gestureIds: string[]
  expressions?: Array<{ name: string; kind: string }>
  moods?: string[]
  clothes?: string[]
  inlineTagsEnabled?: boolean
}): string {
  const catalog: CharacterSkillCatalog = {
    gestureIds: opts.gestureIds,
    moods: opts.moods ?? [],
    expressions: opts.expressions ?? [],
    clothes: opts.clothes,
  }
  const skill = buildCharacterSkillPrompt({
    catalog,
    inlineTagsEnabled: opts.inlineTagsEnabled,
    ttsEnabled: opts.ttsEnabled,
    ttsGuide: FISH_TTS_ANNOTATION_GUIDE,
  })
  return [opts.basePrompt.trim(), skill].filter(Boolean).join('\n\n')
}
