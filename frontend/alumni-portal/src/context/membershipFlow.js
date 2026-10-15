import { createContext, useContext } from "react";
export const MembershipFlowContext = createContext(null);
export const useMembershipFlow = () => useContext(MembershipFlowContext);
