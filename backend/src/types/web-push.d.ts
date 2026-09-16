declare module 'web-push' {
  const webPush: {
    setVapidDetails: (subject: string, publicKey: string, privateKey: string) => void
    sendNotification: (
      subscription: {
        endpoint: string
        keys: {
          p256dh: string
          auth: string
        }
      },
      payload: string,
    ) => Promise<unknown>
  }

  export default webPush
}
