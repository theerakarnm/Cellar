import { ChannelsSection } from "../components/ChannelsSection";
import { GlobalSettings } from "../components/GlobalSettings";

export function Settings() {
  return (
    <>
      <h1>Settings</h1>
      <GlobalSettings />
      <ChannelsSection />
    </>
  );
}
