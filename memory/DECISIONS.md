# Decision Log

Record only decisions that affect architecture, security, scope or
workflow. Newest first.

  ----------------------------------------------------------------------------------------
  Date           ID             Decision                Reason / evidence   Status
  -------------- -------------- ----------------------- ------------------- --------------
  2026-10-26     DEC-001        Optimize for a local    User confirmed      Confirmed
                                end-to-end SIH demo,    demo/auth approach  
                                solo developer,         and local           
                                synthetic data and mock deployment.         
                                integrations.                               

  2026-10-26     DEC-002        Use a modular monolith  Lowest              Proposed
                                as the default          setup/deployment    
                                architecture; avoid     overhead for the    
                                microservices.          prototype;          
                                                        consistent with     
                                                        `PDR.md`.           

  2026-10-26     DEC-003        Inspect the repository  User is unsure of   Required at M0
                                before choosing or      current             
                                changing the actual     repository/stack;   
                                stack.                  PDR stack is        
                                                        ASM-005 assumption. 

  2026-10-26     DEC-004        Treat Freebuff as the   User specified      Provisional
                                intended coding agent,  Freebuff; its exact 
                                but keep `AGENTS.md`    instruction-file    
                                tool-neutral.           compatibility has   
                                                        not been verified.  

  2026-10-26     DEC-005        Keep regulatory rules   Explicit safety     Required
                                pending until           requirements in     
                                applicability/current   `PDR.md`.           
                                sources and authorized                      
                                interpretation are                          
                                confirmed.                                  

  2026-10-26     DEC-006        Do not implement live   Explicit PDR        Confirmed
                                bank/AICTE/identity     non-goals and demo  
                                integrations or fund    constraints.        
                                movement in the                             
                                prototype.                                  
  ----------------------------------------------------------------------------------------

## How to add a decision

Add one row with date, ID, decision, reason/evidence and status
(`Proposed`, `Confirmed`, `Superseded`). For a superseded decision, keep
the old row and add a new one; do not erase history.
