declare module '@nexus/character-react' {
  export function SceneRoomCanvas(props: {
    occupants: import('./scene-occupant-ref.js').SceneRoomOccupant[]
    gestureManifestUrl?: string
    className?: string
    style?: React.CSSProperties
    phoneVrEnabled?: boolean
    phoneVrScopeKey?: string
    onPhoneVrStatus?: (status: unknown) => void
    onVrShellRequest?: (action: 'lockLandscape' | 'unlockOrientation') => void
  }): JSX.Element

  export function PhoneVrPanel(props: {
    room: unknown
    scopeKey?: string
    onShellRequest?: (action: 'lockLandscape' | 'unlockOrientation') => void
    className?: string
    style?: React.CSSProperties
  }): JSX.Element
}
