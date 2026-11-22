import { describe, expect, it } from "vitest";
import { heuristicReply } from "@/server/ai/prompts/reply";

describe("reply categorisation (heuristic / mock mode)", () => {
  const cat = (text: string, subject: string | null = null) => heuristicReply(text, subject, "nl").category;
  it("classifies common Dutch replies", () => {
    expect(cat("Graag even bellen, past dinsdag om 10:00?")).toBe("meeting_request");
    expect(cat("Klinkt interessant, stuur maar wat meer.")).toBe("interested");
    expect(cat("Nee bedankt, geen interesse.")).toBe("not_interested");
    expect(cat("Wilt u mij afmelden?")).toBe("unsubscribe");
    expect(cat("Dit is spam, ik meld dit bij de Autoriteit Persoonsgegevens")).toBe("complaint");
    expect(cat("Ik ben afwezig tot 1 december.", "Afwezig")).toBe("out_of_office");
    expect(cat("Neem volgend kwartaal maar contact op.")).toBe("follow_up_later");
    expect(cat("Wat kost dat ongeveer?")).toBe("more_info");
  });
  it("flags objections", () => {
    expect(heuristicReply("Haal ons van uw lijst, niet meer mailen", null, "nl").objects_to_contact).toBe(true);
  });
});
